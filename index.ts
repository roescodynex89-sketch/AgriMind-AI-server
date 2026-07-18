import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";


import Groq from "groq-sdk";
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

const corsOptions = {
  origin: process.env.CLIENT_URI,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Express Custom Request Interface for Auth Middleware
interface CustomRequest extends Request {
  user?: {
    id: string;
    name?: string;
    email?: string;
  };
}

// Better Auth JWKS Configuration
const clientAuthUrl = process.env.CLIENT_URI || "http://localhost:3000";
const JWKS_URL = new URL(`${clientAuthUrl}/api/auth/jwks`);
const JWKS = createRemoteJWKSet(JWKS_URL);

// JWKS Middleware to verify Better Auth JWT via Authorization Header
const verifyBetterAuthJWT = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized access: Token missing" });
      return;
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS);

    req.user = {
      id: payload.sub as string,
      name: payload.name as string | undefined,
      email: payload.email as string | undefined,
    };

    next();
  } catch (error) {
    res
      .status(401)
      .json({ error: "Unauthorized access: Invalid or expired token" });
  }
};

// MongoDB Connection Setup
const uri = process.env.MONGO_DB_URI;
if (!uri) {
  throw new Error("Please add your MONGO_DB_URI to environment variables");
}

const client = new MongoClient(uri);
const db = client.db("AgriMind");

// Collections
const usersCollection = db.collection("users");
const cropsCollection = db.collection("crops");
const commentsCollection = db.collection("comments");

const chatHistoryCollection = db.collection("chatHistory");

// Database Connection Verify
async function connectDB() {
  try {
    await client.connect();
    console.log("🍃 Connected successfully to MongoDB (database: AgriMind)");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}
connectDB();



// Ekhon eta:
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });




// -------------------- 1. USER(name update) MANAGEMENT API --------------------

app.put(
  "/api/users/profile",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const { name } = req.body;

      const result = await usersCollection.updateOne(
        { _id: userId as any },
        { $set: { name, updatedAt: new Date() } },
        { upsert: true },
      );

      res.json({
        success: true,
        message: "Profile updated successfully",
        result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// --------------------crops explore --------------------

app.get("/api/crops", async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    let query: any = {};

    if (search) query.name = { $regex: search, $options: "i" }; // Case-insensitive সার্চ

    const crops = await cropsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(crops);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// (Details Page)
app.get("/api/crops/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const crop = await cropsCollection.findOne({
      _id: new ObjectId(id as string),
    });

    if (!crop) {
      res.status(404).json({ error: "Crop not found" });
      return;
    }
    res.json(crop);
  } catch (error: any) {
    res.status(400).json({ error: "Invalid Crop ID format" });
  }
});

// --------------------------------------------------

//  (Add Crops - Protected)
app.post(
  "/api/crops",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const {
        name,
        imageUrl,
        description,
        farmingTips,
        commonDiseases,
        difficulty,
        season,
        location,
      } = req.body;

      const newCrop = {
        name,
        imageUrl,
        description,
        farmingTips,
        commonDiseases,
        difficulty,
        season,
        location,

        userId: req.user?.id,
        createdBy: req.user?.name,
        createdAt: new Date(),
      };

      const result = await cropsCollection.insertOne(newCrop);
      res.status(201).json({
        success: true,
        message: "Crop added successfully",
        cropId: result.insertedId,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// (Edit Crop - Protected)
app.put(
  "/api/crops/:id",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const { id } = req.params;
      const {
        name,
        imageUrl,
        description,
        farmingTips,
        commonDiseases,
        difficulty,
        season,
        location,
      } = req.body;
      const userId = req.user?.id;

   
      const crop = await cropsCollection.findOne({
        _id: new ObjectId(id as string),
      });
      if (!crop || crop.userId !== userId) {
        res.status(403).json({ error: "Unauthorized or Crop not found" });
        return;
      }

      const result = await cropsCollection.updateOne(
        { _id: new ObjectId(id as string) },
        {
          $set: {
            name,
            imageUrl,
            description,
            farmingTips,
            commonDiseases,
            difficulty,
            season,
            location,

            updatedAt: new Date(),
          },
        },
      );

      res.json({ success: true, message: "Crop updated successfully", result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

//  (Delete Crop - Protected)
app.delete(
  "/api/crops/:id",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const crop = await cropsCollection.findOne({
        _id: new ObjectId(id as string),
      });
      if (!crop || crop.userId !== userId) {
        res.status(403).json({ error: "Unauthorized or Crop not found" });
        return;
      }

      const result = await cropsCollection.deleteOne({
        _id: new ObjectId(id as string),
      });
      res.json({ success: true, message: "Crop deleted successfully", result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// --------------------  USER COMMENTS MANAGEMENT API --------------------

// cmnt
app.get("/api/comments/:cropId", async (req: Request, res: Response) => {
  try {
    const { cropId } = req.params;
    const comments = await commentsCollection
      .find({ cropId })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(comments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// (Edit Comment - Protected)
app.put(
  "/api/comments/:id",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { text } = req.body;
      const userId = req.user?.id;

      const comment = await commentsCollection.findOne({
        _id: new ObjectId(id as string),
      });
      if (!comment || comment.userId !== userId) {
        res.status(403).json({ error: "Unauthorized to edit this comment" });
        return;
      }

      const result = await commentsCollection.updateOne(
        { _id: new ObjectId(id as string) },
        { $set: { text, updatedAt: new Date() } },
      );

      res.json({
        success: true,
        message: "Comment updated successfully",
        result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

//  (Delete Comment - Protected)
app.delete(
  "/api/comments/:id",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const comment = await commentsCollection.findOne({
        _id: new ObjectId(id as string),
      });
      if (!comment || comment.userId !== userId) {
        res.status(403).json({ error: "Unauthorized to delete this comment" });
        return;
      }

      const result = await commentsCollection.deleteOne({
        _id: new ObjectId(id as string),
      });
      res.json({
        success: true,
        message: "Comment deleted successfully",
        result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.get(
  "/api/comments/user",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const comments = await commentsCollection
        .find({ userId: req.user?.id })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(comments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.post(
  "/api/comments",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const { cropId, text } = req.body;

      const crop = await cropsCollection.findOne({
        _id: new ObjectId(cropId as string),
      });

      const newComment = {
        cropId,
        cropName: crop?.name || "Unknown Crop",
        userId: req.user?.id,
        userName: req.user?.name || "Anonymous",
        text,
        createdAt: new Date(),
      };

      const result = await commentsCollection.insertOne(newComment);
      res.status(201).json({ success: true, commentId: result.insertedId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);






// -------------------- AI CHAT ASSISTANT API --------------------

app.post(
  "/api/ai/chat",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const { message } = req.body;
      const userId = req.user?.id;

      if (!message || !message.trim()) {
        res.status(400).json({ error: "Message is required" });
        return;
      }

      // Age-er 10 ta message context hisebe nao (optional but recommended)
      const previousMessages = await chatHistoryCollection
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();

      const conversationHistory = previousMessages.reverse().map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.text as string,
      }));

      const systemPrompt = `
        Tumi AgriMind AI — ekjon krishi upodesta.
        Bangladeshi krishokder fosol, mati, rog-baladi, sar, ar
        mausum songkranto proshner shohoj, practical uttor dao.
        Uttor songkhipto rakho.
      `;

     const completion = await groq.chat.completions.create({
  model: "llama-3.3-70b-versatile",
  messages: [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: message },
  ],
  temperature: 0.6,
});

      const reply = completion.choices[0]?.message?.content ?? "";

      // Database-e save koro (both user message ar AI reply)
      await chatHistoryCollection.insertMany([
        { userId, role: "user", text: message, createdAt: new Date() },
        { userId, role: "assistant", text: reply, createdAt: new Date() },
      ]);

      res.json({ reply });
    } catch (error: any) {
      console.error("AI chat error:", error);
      res.status(500).json({ error: "AI response generate korte problem hoyeche" });
    }
  },
);

// Chat history load korar jonno (page reload korle purono chat dekhabe)
app.get(
  "/api/ai/chat/history",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const history = await chatHistoryCollection
        .find({ userId })
        .sort({ createdAt: 1 })
        .toArray();
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

















// Base Route
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "AgriMind AI Backend is running successfully!" });
});

app.listen(PORT, () => {
  console.log(`⚡ AgriMind Real Backend running on http://localhost:${PORT}`);
});
