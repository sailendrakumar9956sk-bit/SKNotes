import express from "express";
import Groq from "groq-sdk";
import PDFDocument from "pdfkit";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

/* =========================
   GROQ AI
========================= */

const ai = process.env.GROQ_API_KEY
  ? new Groq({
      apiKey: process.env.GROQ_API_KEY
    })
  : null;


/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});


/* =========================
   FLASHCARDS
========================= */

app.post("/api/flashcards", async (req, res) => {
  try {
    const { text = "" } = req.body || {};

    if (!text.trim()) {
      return res.status(400).json({
        error: "Notes text missing."
      });
    }

    if (!ai) {
      return res.status(503).json({
        error: "Groq AI key configure nahi hui hai."
      });
    }

    const prompt = `
You are SKNotes, an AI study assistant.

Create 8-12 useful study flashcards from the notes below.

Return ONLY valid JSON in exactly this format:

[
  {
    "question": "Question here",
    "answer": "Answer here"
  }
]

Rules:
- Use only information supported by the notes.
- Questions should be useful for revision.
- Answers should be short and clear.
- Do not add markdown.
- Do not add explanations outside JSON.
- Do not invent information.

NOTES:
${text.slice(0, 30000)}
`;

    const completion = await ai.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2
    });

    let raw =
      completion.choices?.[0]?.message?.content?.trim() || "";

    raw = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");

    if (start !== -1 && end !== -1) {
      raw = raw.slice(start, end + 1);
    }

    const flashcards = JSON.parse(raw);

    if (!Array.isArray(flashcards)) {
      throw new Error("AI response format invalid.");
    }

    res.json({
      flashcards
    });

  } catch (err) {
    console.error("Flashcards error:", err);

    res.status(500).json({
      error:
        err?.message ||
        "Flashcards banane me problem aayi."
    });
  }
});



/* =========================
   NOTES → QUIZ / MCQ
========================= */

app.post("/api/quiz", async (req, res) => {
  try {
    const { text = "" } = req.body || {};

    if (!text.trim()) {
      return res.status(400).json({
        error: "Notes text missing."
      });
    }

    if (!ai) {
      return res.status(503).json({
        error: "Groq AI key configure nahi hui hai."
      });
    }

    const prompt = `
You are SKNotes, an AI study assistant.

Create exactly 10 useful multiple-choice questions from the notes below.

Return ONLY valid JSON in this exact format:

{
  "quiz": [
    {
      "question": "Question here",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": "Option A"
    }
  ]
}

Rules:
- Create exactly 10 questions.
- Each question must have exactly 4 options.
- Only one option must be correct.
- The answer must exactly match one of the four options.
- Use only information supported by the notes.
- Keep questions and answers short and clear.
- Do not use markdown.
- Do not add any text outside the JSON.
- Do not invent information.

NOTES:
${text.slice(0, 30000)}
`;

    const completion = await ai.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2,
      response_format: {
        type: "json_object"
      }
    });

    const raw =
      completion.choices?.[0]?.message?.content?.trim() || "";

    if (!raw) {
      throw new Error("AI ne koi response nahi diya.");
    }

    const parsed = JSON.parse(raw);

    if (!parsed.quiz || !Array.isArray(parsed.quiz)) {
      throw new Error("AI quiz format invalid.");
    }

    res.json({
      quiz: parsed.quiz
    });

  } catch (err) {
    console.error("Quiz error:", err);

    res.status(500).json({
      error:
        err?.message ||
        "Quiz banane me problem aayi."
    });
  }
});

/* =========================
   YOUTUBE NOTES
========================= */

app.post("/api/notes", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        error: "YouTube URL missing."
      });
    }

    if (!process.env.YOUTUBE_TRANSCRIPT_API_KEY) {
      return res.status(503).json({
        error: "YouTube Transcript API key configure nahi hui hai."
      });
    }

    if (!ai) {
      return res.status(503).json({
        error: "Groq AI key configure nahi hui hai."
      });
    }

    const videoIdMatch =
      url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&?/]+)/
      );

    const videoId = videoIdMatch?.[1];

    if (!videoId) {
      return res.status(400).json({
        error: "Valid YouTube URL nahi hai."
      });
    }

    const transcriptResponse = await fetch(
      "https://www.youtubetranscript.dev/api/v2/transcribe",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${process.env.YOUTUBE_TRANSCRIPT_API_KEY}`
        },
        body: JSON.stringify({
          video_id: videoId
        })
      }
    );

    const transcriptData =
      await transcriptResponse.json();

    if (!transcriptResponse.ok) {
      return res.status(500).json({
        error:
          transcriptData?.message ||
          "Transcript fetch nahi ho paya."
      });
    }

    const transcript =
      transcriptData?.data?.transcript?.text?.trim();

    if (!transcript) {
      return res.status(404).json({
        error: "Is video ka transcript nahi mila."
      });
    }

    const prompt = `
You are SKNotes, an AI study assistant.

Convert the following YouTube transcript into clear study notes.

Make:
1. Main topic
2. Important concepts
3. Key points
4. Definitions
5. Examples where available
6. Short revision summary

Use simple student-friendly language.

Transcript:
${transcript.slice(0, 50000)}
`;

    const completion =
      await ai.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3
      });

    const notes =
      completion.choices?.[0]?.message?.content || "";

    res.json({
      videoId,
      notes
    });

  } catch (err) {
    console.error("YouTube Notes error:", err);

    res.status(500).json({
      error:
        err?.message ||
        "YouTube notes banane me problem aayi."
    });
  }
});


/* =========================
   PDF EXPORT
========================= */

app.post("/api/pdf", async (req, res) => {
  try {
    const {
      title = "SKNotes",
      notes = ""
    } = req.body || {};

    if (!notes.trim()) {
      return res.status(400).json({
        error: "Notes missing."
      });
    }

    const doc = new PDFDocument({
      margin: 50
    });

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${title
        .replace(/[^a-z0-9]/gi, "_")
        .slice(0, 50)}.pdf"`
    );

    doc.pipe(res);

    doc
      .fontSize(22)
      .text(title, {
        align: "center"
      });

    doc.moveDown();

    doc
      .fontSize(11)
      .text(notes);

    doc.end();

  } catch (err) {
    console.error("PDF error:", err);

    if (!res.headersSent) {
      res.status(500).json({
        error:
          err?.message ||
          "PDF banane me problem aayi."
      });
    }
  }
});


/* =========================
   SERVER START
========================= */

app.listen(PORT, () => {
  console.log(
    `SKNotes server running on port ${PORT}`
  );
});
