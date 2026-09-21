import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { YoutubeTranscript } from "youtube-transcript";

const app = express();
app.use(express.json({limit:"3mb"}));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const ai = process.env.OPENAI_API_KEY ? new OpenAI({apiKey:process.env.OPENAI_API_KEY}) : null;

function getVideoId(value){
  try{
    const u = new URL(value.trim());
    if(u.hostname === "youtu.be" || u.hostname.endsWith(".youtu.be"))
      return u.pathname.split("/").filter(Boolean)[0] || null;
    if(u.hostname.includes("youtube.com"))
  return u.searchParams.get("v") ||
    (u.pathname.match(/\/(?:shorts|live)\/([^/]+)/)?.[1] ?? null);
  return null;
  } catch {}
}

app.get("/api/health",(req,res)=>res.json({ok:true, aiConfigured:!!ai}));

app.post("/api/notes", async (req,res)=>{
  try{
    const {url, language="Hindi/Hinglish", level="Class 11-12"} = req.body || {};
    const id = getVideoId(url || "");
    if(!id) return res.status(400).json({error:"Valid YouTube video link डालें।"});
    if(!ai) return res.status(503).json({error:"SKNotes में AI key अभी configure नहीं हुई है। Server में OPENAI_API_KEY जोड़ें।"});

    const transcriptItems = await YoutubeTranscript.fetchTranscript(id);
    const transcript = transcriptItems.map(x=>x.text).join(" ").replace(/\s+/g," ").trim();
    if(!transcript) throw new Error("इस वीडियो का accessible transcript/captions नहीं मिला।");

    const clipped = transcript.slice(0,110000);
    const prompt = `You are SKNotes, an exam-focused study-note generator for Indian students.
Create accurate, compact but useful notes from the supplied YouTube lecture transcript.
Language: ${language}. Student level: ${level}.
Rules:
- Never invent facts not supported by the transcript.
- Keep formulas, symbols and numerical steps readable.
- Use clear Markdown headings.
- Include:
1. Lecture title/topic
2. Key concepts
3. Definitions
4. Detailed notes
5. Formulas / equations (if applicable)
6. Solved examples or methods mentioned
7. Common mistakes / cautions
8. Quick revision
9. Important exam questions
Make it easy to revise from a phone and suitable for PDF export.

TRANSCRIPT:
${clipped}`;

    const response = await ai.responses.create({
      model: "gpt-5-mini",
      input: prompt
    });

    res.json({videoId:id, notes:response.output_text});
  }catch(err){
    res.status(500).json({error: err?.message || "Notes बनाते समय समस्या आई।"});
  }
});

app.post("/api/pdf", (req,res)=>{
  const {notes="", title="SKNotes"} = req.body || {};
  if(!notes.trim()) return res.status(400).send("Notes missing");
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",'attachment; filename="SKNotes.pdf"');

  const doc = new PDFDocument({margin:45, size:"A4"});
  doc.pipe(res);
  doc.fontSize(22).text("SKNotes", {align:"center"});
  doc.moveDown(.3);
  doc.fontSize(11).text(title, {align:"center"});
  doc.moveDown();
  doc.fontSize(10);
  for(const line of notes.split("\n")){
    const t=line.replace(/^#{1,6}\s*/,"").replace(/\*\*/g,"");
    if(!t.trim()){ doc.moveDown(.35); continue; }
    doc.text(t,{lineGap:3});
  }
  doc.end();
});

app.listen(PORT,()=>console.log(`SKNotes running on http://localhost:${PORT}`));
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});
