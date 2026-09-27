import express from "express";
import Groq from "groq-sdk";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";
import Tesseract from "tesseract.js";

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   APP CONFIG
========================= */

app.use(express.json({ limit: "15mb" }));
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
   SUPABASE ADMIN
========================= */

const supabaseAdmin =
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    : null;

/* =========================================================
   AUTH HELPERS
========================================================= */

async function getAuthenticatedUser(req) {
  try {
    if (!supabaseAdmin) return null;

    const authHeader =
      req.headers.authorization || "";

    const token =
      authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) return null;

    const {
      data,
      error
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      return null;
    }

    return data.user;

  } catch (error) {
    console.error(
      "Authentication error:",
      error.message
    );

    return null;
  }
}

/* =========================================================
   USER ACTIVITY TRACKING
========================================================= */

async function trackActivity(
  req,
  eventType,
  toolName = null
) {
  try {
    if (!supabaseAdmin) return;

    const user =
      await getAuthenticatedUser(req);

    if (!user) return;

    const {
      error
    } = await supabaseAdmin
      .from("user_activity")
      .insert({
        user_id: user.id,
        event_type: eventType,
        tool_name: toolName
      });

    if (error) {
      console.error(
        "Activity insert error:",
        error.message
      );
    }

  } catch (error) {
    console.error(
      "Activity tracking error:",
      error.message
    );
  }
}

/* =========================================================
   ADMIN AUTHENTICATION
========================================================= */

async function requireAdmin(req, res) {
  try {
    const user =
      await getAuthenticatedUser(req);

    if (!user) {
      res.status(401).json({
        error: "Login required."
      });

      return null;
    }

    const adminEmail =
      process.env.ADMIN_EMAIL
        ?.trim()
        .toLowerCase();

    if (!adminEmail) {
      res.status(503).json({
        error:
          "ADMIN_EMAIL environment variable configure nahi hui hai."
      });

      return null;
    }

    const userEmail =
      user.email
        ?.trim()
        .toLowerCase();

    if (
      !userEmail ||
      userEmail !== adminEmail
    ) {
      res.status(403).json({
        error:
          "Admin access required."
      });

      return null;
    }

    return user;

  } catch (error) {
    console.error(
      "Admin authentication error:",
      error.message
    );

    res.status(500).json({
      error:
        "Admin authentication failed."
    });

    return null;
  }
}

/* =========================
   HELPERS
========================= */

function requireAI(res) {
  if (!ai) {
    res.status(503).json({
      error:
        "Groq AI key configure nahi hui hai."
    });

    return false;
  }

  return true;
}

function cleanAIJson(raw) {
  if (!raw) return "";

  raw = raw.trim();

  raw = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const arrayStart =
    raw.indexOf("[");

  const arrayEnd =
    raw.lastIndexOf("]");

  if (
    arrayStart !== -1 &&
    arrayEnd !== -1 &&
    arrayEnd > arrayStart
  ) {
    return raw.slice(
      arrayStart,
      arrayEnd + 1
    );
  }

  const objectStart =
    raw.indexOf("{");

  const objectEnd =
    raw.lastIndexOf("}");

  if (
    objectStart !== -1 &&
    objectEnd !== -1 &&
    objectEnd > objectStart
  ) {
    return raw.slice(
      objectStart,
      objectEnd + 1
    );
  }

  return raw;
}

async function askAI(
  prompt,
  options = {}
) {
  if (!ai) {
    throw new Error(
      "Groq AI key configure nahi hui hai."
    );
  }

  const completion =
    await ai.chat.completions.create({
      model:
        options.model ||
        "openai/gpt-oss-20b",

      messages: [
        {
          role: "system",
          content:
            options.system ||
            "You are SKNotes, an AI study assistant. Give accurate, student-friendly answers."
        },
        {
          role: "user",
          content: prompt
        }
      ],

      temperature:
        options.temperature ?? 0.3,

      max_completion_tokens:
        options.max_completion_tokens ||
        4096
    });

  return (
    completion
      .choices?.[0]
      ?.message
      ?.content
      ?.trim() || ""
  );
}

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.sendFile("index.html", {
    root: "public"
  });
});

/* =========================================================
   1. FLASHCARDS
========================================================= */

app.post(
  "/api/flashcards",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "flashcards"
    );

    try {
      const {
        text = ""
      } = req.body || {};

      if (!text.trim()) {
        return res.status(400).json({
          error:
            "Notes text missing."
        });
      }

      if (!requireAI(res)) return;

      const prompt = `
Create 8-12 useful study flashcards from the notes below.

Return ONLY valid JSON:

[
  {
    "question": "Question",
    "answer": "Answer"
  }
]

Rules:
- Use only information from the notes.
- Keep answers short and clear.
- Do not invent information.
- No markdown.
- No text outside JSON.

NOTES:
${text.slice(0, 30000)}
`;

      const raw =
        await askAI(prompt, {
          temperature: 0.2
        });

      const flashcards =
        JSON.parse(
          cleanAIJson(raw)
        );

      res.json({
        flashcards
      });

    } catch (error) {
      console.error(
        "Flashcards error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Flashcards banane me problem aayi."
      });
    }
  }
);

/* =========================================================
   2. NOTES → QUIZ
========================================================= */

app.post(
  "/api/quiz",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "quiz"
    );

    try {
      const {
        text = ""
      } = req.body || {};

      if (!text.trim()) {
        return res.status(400).json({
          error:
            "Notes text missing."
        });
      }

      if (!requireAI(res)) return;

      const prompt = `
Create exactly 10 multiple-choice questions from these notes.

Return ONLY JSON:

[
  {
    "question": "Question",
    "options": [
      "Option A",
      "Option B",
      "Option C",
      "Option D"
    ],
    "answer": "Option A"
  }
]

Rules:
- Exactly 10 questions.
- Exactly 4 options.
- Only one correct answer.
- Answer must exactly match one option.
- Use only information from the notes.
- No markdown.
- No explanation outside JSON.

NOTES:
${text.slice(0, 30000)}
`;

      const raw =
        await askAI(prompt, {
          temperature: 0.2,
          max_completion_tokens: 4096
        });

      const quiz =
        JSON.parse(
          cleanAIJson(raw)
        );

      res.json({
        quiz
      });

    } catch (error) {
      console.error(
        "Quiz error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Quiz banane me problem aayi."
      });
    }
  }
);

/* =========================================================
   3. AI TUTOR
========================================================= */

app.post(
  "/api/tutor",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "tutor"
    );

    try {
      const {
        messages = []
      } = req.body || {};

      if (!requireAI(res)) return;

      if (
        !Array.isArray(messages) ||
        messages.length === 0
      ) {
        return res.status(400).json({
          error:
            "Message missing."
        });
      }

      const safeMessages =
        messages
          .filter((m) => {
            return (
              m &&
              (
                m.role === "user" ||
                m.role === "assistant"
              ) &&
              typeof m.content === "string" &&
              m.content.trim()
            );
          })
          .slice(-20);

      if (!safeMessages.length) {
        return res.status(400).json({
          error:
            "Valid message missing."
        });
      }

      const completion =
        await ai.chat.completions.create({
          model:
            "openai/gpt-oss-20b",

          messages: [
            {
              role: "system",
              content:
                "You are SKNotes AI Tutor. Help students understand Physics, Chemistry, Maths, Biology, Computer Science and other school subjects. Explain step by step using simple student-friendly language. Do not invent facts."
            },
            ...safeMessages
          ],

          temperature: 0.4,

          max_completion_tokens: 2048
        });

      const answer =
        completion
          .choices?.[0]
          ?.message
          ?.content
          ?.trim() || "";

      if (!answer) {
        return res.status(500).json({
          error:
            "AI ne koi answer nahi diya."
        });
      }

      res.json({
        answer
      });

    } catch (error) {
      console.error(
        "AI Tutor error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "AI Tutor me problem aayi."
      });
    }
  }
);

/* =========================================================
   4. YOUTUBE → AI NOTES
========================================================= */

app.post(
  "/api/notes",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "youtube-notes"
    );

    try {
      const {
        url
      } = req.body || {};

      if (!url) {
        return res.status(400).json({
          error:
            "YouTube URL missing."
        });
      }

      if (
        !process.env
          .YOUTUBE_TRANSCRIPT_API_KEY
      ) {
        return res.status(503).json({
          error:
            "YouTube Transcript API key configure nahi hui hai."
        });
      }

      if (!requireAI(res)) return;

      const videoIdMatch =
        url.match(
          /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([^&?/]+)/
        );

      const videoId =
        videoIdMatch?.[1];

      if (!videoId) {
        return res.status(400).json({
          error:
            "Valid YouTube URL nahi hai."
        });
      }

      const transcriptResponse =
        await fetch(
          "https://www.youtubetranscript.dev/api/v2/transcribe",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

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
        transcriptData
          ?.data
          ?.transcript
          ?.text
          ?.trim();

      if (!transcript) {
        return res.status(404).json({
          error:
            "Is video ka transcript nahi mila."
        });
      }

      const prompt = `
Convert this YouTube lecture transcript into clear study notes.

Include:

1. Main topic
2. Important concepts
3. Key points
4. Definitions
5. Examples
6. Important formulas if present
7. Common mistakes if supported
8. Quick revision summary

Use simple student-friendly language.

TRANSCRIPT:
${transcript.slice(0, 50000)}
`;

      const notes =
        await askAI(prompt, {
          temperature: 0.3
        });

      res.json({
        videoId,
        notes
      });

    } catch (error) {
      console.error(
        "YouTube Notes error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "YouTube notes banane me problem aayi."
      });
    }
  }
);

/* =========================================================
   5. PDF EXPORT
========================================================= */

app.post(
  "/api/pdf",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "pdf"
    );

    try {
      const {
        title = "SKNotes",
        notes = ""
      } = req.body || {};

      if (!notes.trim()) {
        return res.status(400).json({
          error:
            "Notes missing."
        });
      }

      const doc =
        new PDFDocument({
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

    } catch (error) {
      console.error(
        "PDF error:",
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          error:
            error.message ||
            "PDF banane me problem aayi."
        });
      }
    }
  }
);

/* =========================================================
   6. IMAGE → TEXT
========================================================= */

app.post(
  "/api/image-to-text",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "image-to-text"
    );

    try {
      const {
        image = ""
      } = req.body || {};

      if (!image) {
        return res.status(400).json({
          error:
            "Image missing."
        });
      }

      if (
        !image.startsWith("data:image/")
      ) {
        return res.status(400).json({
          error:
            "Valid image data nahi mili."
        });
      }

      console.log(
        "Starting OCR..."
      );

      const result =
        await Tesseract.recognize(
          image,
          "eng",
          {
            logger: (info) => {
              if (
                info.status ===
                "recognizing text"
              ) {
                console.log(
                  `OCR progress: ${Math.round(
                    (info.progress || 0) * 100
                  )}%`
                );
              }
            }
          }
        );

      const text =
        result
          ?.data
          ?.text
          ?.trim() || "";

      res.json({
        text
      });

    } catch (error) {
      console.error(
        "OCR error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Image se text read nahi ho paya."
      });
    }
  }
);

/* =========================================================
   7. AI PDF SUMMARIZER
========================================================= */

app.post(
  "/api/pdf-summarize",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "pdf-summarize"
    );

    try {
      const {
        text = ""
      } = req.body || {};

      if (!text.trim()) {
        return res.status(400).json({
          error:
            "PDF text missing."
        });
      }

      if (!requireAI(res)) return;

      const prompt = `
Summarize the following PDF content for a student.

Create:

1. Short summary
2. Main concepts
3. Important definitions
4. Important facts
5. Important formulas
6. Quick revision points

Do not invent information.

CONTENT:
${text.slice(0, 50000)}
`;

      const summary =
        await askAI(prompt, {
          temperature: 0.2
        });

      res.json({
        summary
      });

    } catch (error) {
      console.error(
        "PDF summarizer error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "PDF summarize nahi ho paya."
      });
    }
  }
);

/* =========================================================
   8. AI NOTES GENERATOR
========================================================= */

app.post(
  "/api/notes-generator",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "notes-generator"
    );

    try {
      const {
        text = "",
        subject = "General",
        className = "Class 11-12"
      } = req.body || {};

      if (!text.trim()) {
        return res.status(400).json({
          error:
            "Content missing."
        });
      }

      if (!requireAI(res)) return;

      const prompt = `
Create high-quality study notes.

Subject:
${subject}

Class:
${className}

Content:
${text.slice(0, 40000)}

Format:

TITLE

1. Main Concepts
2. Definitions
3. Important Points
4. Detailed Explanation
5. Examples
6. Formulas
7. Common Mistakes
8. Quick Revision
9. Exam Questions

Use simple student-friendly language.
Do not invent information.
`;

      const notes =
        await askAI(prompt, {
          temperature: 0.3
        });

      res.json({
        notes
      });

    } catch (error) {
      console.error(
        "Notes generator error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Notes generate nahi ho paye."
      });
    }
  }
);

/* =========================================================
   9. STUDY PLANNER
========================================================= */

app.post(
  "/api/study-planner",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "study-planner"
    );

    try {
      const {
        subjects = [],
        hours = 4,
        days = 7,
        examDate = ""
      } = req.body || {};

      if (
        !Array.isArray(subjects) ||
        subjects.length === 0
      ) {
        return res.status(400).json({
          error:
            "Subjects missing."
        });
      }

      if (!requireAI(res)) return;

      const prompt = `
Create a practical study timetable.

Subjects:
${subjects.join(", ")}

Study hours per day:
${hours}

Number of days:
${days}

Exam date:
${examDate || "Not provided"}

Create a day-by-day plan.

Include:
- Subject
- Study topic
- Time
- Revision
- Practice/questions
- Breaks

Keep the plan realistic for a student.
`;

      const plan =
        await askAI(prompt, {
          temperature: 0.4
        });

      res.json({
        plan
      });

    } catch (error) {
      console.error(
        "Study planner error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Study planner me problem aayi."
      });
    }
  }
);

/* =========================================================
   10. STUDY PROGRESS
========================================================= */

app.post(
  "/api/study-progress",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "study-progress"
    );

    try {
      const {
        subjects = [],
        studyHours = 0,
        completedTopics = 0,
        totalTopics = 0,
        quizScore = 0
      } = req.body || {};

      const progress =
        totalTopics > 0
          ? Math.round(
              (completedTopics /
                totalTopics) *
                100
            )
          : 0;

      res.json({
        progress,
        studyHours,
        completedTopics,
        totalTopics,
        quizScore,
        subjects
      });

    } catch (error) {
      console.error(
        "Study progress error:",
        error
      );

      res.status(500).json({
        error:
          "Study progress calculate nahi ho paya."
      });
    }
  }
);

/* =========================================================
   11. AI VOICE TUTOR
========================================================= */

app.post(
  "/api/voice-tutor",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "voice-tutor"
    );

    try {
      const {
        question = ""
      } = req.body || {};

      if (!question.trim()) {
        return res.status(400).json({
          error:
            "Question missing."
        });
      }

      if (!requireAI(res)) return;

      const answer =
        await askAI(
          `
Answer this student's question
in a way that is easy to listen to.

Keep sentences natural and clear.
Avoid unnecessary formatting.

QUESTION:
${question.slice(0, 10000)}
`,
          {
            temperature: 0.4,
            max_completion_tokens: 2048
          }
        );

      res.json({
        answer
      });

    } catch (error) {
      console.error(
        "Voice tutor error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Voice Tutor me problem aayi."
      });
    }
  }
);

/* =========================================================
   12. AI WEB RESEARCH
========================================================= */

app.post(
  "/api/web-research",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "web-research"
    );

    try {
      const {
        query = ""
      } = req.body || {};

      if (!query.trim()) {
        return res.status(400).json({
          error:
            "Research query missing."
        });
      }

      if (!requireAI(res)) return;

      const answer =
        await askAI(
          `
You are an educational research assistant.

Explain the following research topic clearly.

TOPIC:
${query.slice(0, 10000)}

Include:
- Overview
- Important points
- Key facts
- Explanation
- Conclusion

Do not pretend that you performed live web browsing.
`,
          {
            temperature: 0.3
          }
        );

      res.json({
        answer,
        liveSearch: false
      });

    } catch (error) {
      console.error(
        "Web research error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Web research me problem aayi."
      });
    }
  }
);

/* =========================================================
   13. EXAM PAPER GENERATOR
========================================================= */

app.post(
  "/api/exam-paper",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "exam-paper"
    );

    try {
      const {
        subject = "",
        className = "",
        chapters = "",
        totalMarks = 50,
        difficulty = "medium"
      } = req.body || {};

      if (!subject.trim()) {
        return res.status(400).json({
          error:
            "Subject missing."
        });
      }

      if (!requireAI(res)) return;

      const prompt = `
Create a school-level exam paper.

Subject:
${subject}

Class:
${className || "Not specified"}

Chapters:
${chapters || "All provided chapters"}

Total marks:
${totalMarks}

Difficulty:
${difficulty}

Create:
- Instructions
- Section A
- Section B
- Section C
- Appropriate marks
- Questions suitable for the class

Do not invent syllabus-specific facts that are not reasonably supported.
`;

      const paper =
        await askAI(prompt, {
          temperature: 0.4,
          max_completion_tokens: 5000
        });

      res.json({
        paper
      });

    } catch (error) {
      console.error(
        "Exam paper error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Exam paper generate nahi hua."
      });
    }
  }
);

/* =========================================================
   14. AI DOUBT SOLVER
========================================================= */

app.post(
  "/api/doubt-solver",
  async (req, res) => {

    await trackActivity(
      req,
      "tool_used",
      "doubt-solver"
    );

    try {
      const {
        question = "",
        subject = ""
      } = req.body || {};

      if (!question.trim()) {
        return res.status(400).json({
          error:
            "Question missing."
        });
      }

      if (!requireAI(res)) return;

      const prompt = `
Solve this student's doubt.

Subject:
${subject || "General"}

Question:
${question.slice(0, 15000)}

Explain:
1. What the question asks
2. Concept required
3. Step-by-step solution
4. Final answer
5. One quick tip

Use simple student-friendly language.
Do not invent information.
`;

      const answer =
        await askAI(prompt, {
          temperature: 0.25,
          max_completion_tokens: 3000
        });

      res.json({
        answer
      });

    } catch (error) {
      console.error(
        "Doubt solver error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Doubt solve nahi ho paya."
      });
    }
  }
);

/* =========================================================
   15. ADMIN DASHBOARD STATISTICS
========================================================= */

app.get(
  "/api/admin/stats",
  async (req, res) => {

    try {
      const admin =
        await requireAdmin(req, res);

      if (!admin) return;

      if (!supabaseAdmin) {
        return res.status(503).json({
          error:
            "Supabase admin configuration missing."
        });
      }

      /* =========================
         TOTAL USERS
      ========================= */

      let totalUsers = 0;
      let page = 1;
      const perPage = 1000;

      while (true) {
        const result =
          await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage
          });

        if (result.error) {
          throw result.error;
        }

        const users =
          result.data?.users || [];

        totalUsers += users.length;

        if (
          users.length < perPage
        ) {
          break;
        }

        page++;
      }

      /* =========================
         ACTIVITY DATA
      ========================= */

      const {
        data: activities,
        error: activityError
      } =
        await supabaseAdmin
          .from("user_activity")
          .select(
            "user_id,event_type,tool_name,created_at"
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(10000);

      if (activityError) {
        throw activityError;
      }

      const rows =
        activities || [];

      const now =
        Date.now();

      const todayStart =
        new Date();

      todayStart.setHours(
        0,
        0,
        0,
        0
      );

      const sevenDaysAgo =
        new Date(
          now -
          7 * 24 * 60 * 60 * 1000
        );

      const thirtyDaysAgo =
        new Date(
          now -
          30 * 24 * 60 * 60 * 1000
        );

      const todayUsers =
        new Set();

      const sevenDayUsers =
        new Set();

      const thirtyDayUserDays =
        new Map();

      const toolUsage = {};

      for (const activity of rows) {
        const date =
          new Date(
            activity.created_at
          );

        const userId =
          activity.user_id;

        if (
          date >= todayStart
        ) {
          todayUsers.add(
            userId
          );
        }

        if (
          date >= sevenDaysAgo
        ) {
          sevenDayUsers.add(
            userId
          );
        }

        if (
          date >= thirtyDaysAgo
        ) {
          if (
            !thirtyDayUserDays.has(
              userId
            )
          ) {
            thirtyDayUserDays.set(
              userId,
              new Set()
            );
          }

          const day =
            date
              .toISOString()
              .slice(0, 10);

          thirtyDayUserDays
            .get(userId)
            .add(day);
        }

        if (
          activity.tool_name
        ) {
          toolUsage[
            activity.tool_name
          ] =
            (toolUsage[
              activity.tool_name
            ] || 0) + 1;
        }
      }

      /*
        Regular user definition:
        User active on 3 or more
        different days during
        the last 30 days.
      */

      let regularUsers = 0;

      for (
        const days
        of thirtyDayUserDays.values()
      ) {
        if (days.size >= 3) {
          regularUsers++;
        }
      }

      res.json({
        totalUsers,

        activeToday:
          todayUsers.size,

        activeLast7Days:
          sevenDayUsers.size,

        regularUsers,

        totalActivities:
          rows.length,

        toolUsage,

        generatedAt:
          new Date().toISOString()
      });

    } catch (error) {
      console.error(
        "Admin stats error:",
        error
      );

      res.status(500).json({
        error:
          "Admin statistics fetch nahi ho sake."
      });
    }
  }
);

/* =========================================================
   16. ADMIN USERS COUNT
========================================================= */

app.get(
  "/api/admin/users-count",
  async (req, res) => {

    try {
      const admin =
        await requireAdmin(req, res);

      if (!admin) return;

      if (!supabaseAdmin) {
        return res.status(503).json({
          error:
            "Supabase admin configuration missing."
        });
      }

      let totalUsers = 0;
      let page = 1;
      const perPage = 1000;

      while (true) {
        const result =
          await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage
          });

        if (result.error) {
          throw result.error;
        }

        const users =
          result.data?.users || [];

        totalUsers +=
          users.length;

        if (
          users.length < perPage
        ) {
          break;
        }

        page++;
      }

      res.json({
        totalUsers
      });

    } catch (error) {
      console.error(
        "Users count error:",
        error
      );

      res.status(500).json({
        error:
          "Users count fetch nahi ho saka."
      });
    }
  }
);

/* =========================================================
   17. HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,

      aiConfigured:
        !!process.env.GROQ_API_KEY,

      transcriptConfigured:
        !!process.env
          .YOUTUBE_TRANSCRIPT_API_KEY,

      supabaseConfigured:
        !!(
          process.env.SUPABASE_URL &&
          process.env
            .SUPABASE_SERVICE_ROLE_KEY
        ),

      adminConfigured:
        !!process.env.ADMIN_EMAIL,

      activityTracking:
        !!supabaseAdmin,

      features: {
        flashcards: true,
        quiz: true,
        tutor: true,
        youtubeNotes: true,
        pdfExport: true,
        imageToText: true,
        pdfSummarizer: true,
        notesGenerator: true,
        studyPlanner: true,
        studyProgress: true,
        voiceTutor: true,
        webResearch: true,
        examPaper: true,
        doubtSolver: true,
        adminStats: true
      }
    });
  }
);

/* =========================================================
   404 API HANDLER
========================================================= */

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      error:
        "API route nahi mila."
    });
  }
);

/* =========================================================
   SERVER START
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `SKNotes server running on port ${PORT}`
    );
  }
);
