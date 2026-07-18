import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";


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

// -------------------- 1. USER MANAGEMENT API --------------------


app.put(
  "/api/users/profile",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const { name, phone, address } = req.body;

      const result = await usersCollection.updateOne(
        { _id: userId as any }, // Better Auth সাধারণত স্ট্রিং ID ব্যবহার করে, তাই ObjectId নাও লাগতে পারে
        { $set: { name, phone, address, updatedAt: new Date() } },
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

// -------------------- 2. CROPS MANAGEMENT API --------------------

// crops explore
app.get("/api/crops", async (req: Request, res: Response) => {
  try {
    const { category, search } = req.query;
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

      // শুধুমাত্র যে ইউজার ক্রপ অ্যাড করেছে সে যেন এডিট করতে পারে তার সিকিউরিটি চেক
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







// -------------------- 3. USER COMMENTS MANAGEMENT API --------------------

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

//  (Create Comment - Protected)
app.post(
  "/api/comments",
  verifyBetterAuthJWT as any,
  async (req: CustomRequest, res: Response) => {
    try {
      const { cropId, text } = req.body;

      const newComment = {
        cropId,
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







// Base Route
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "AgriMind AI Backend is running successfully!" });
});



app.listen(PORT, () => {
  console.log(`⚡ AgriMind Real Backend running on http://localhost:${PORT}`);
});
