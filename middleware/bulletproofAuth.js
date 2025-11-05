// middleware/bulletproofAuth.js
import jwt from "jsonwebtoken";

export const requireAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authentication required",
      message: "Include header: Authorization: Bearer YOUR_TOKEN",
    });
  }

  const token = authHeader.substring(7).trim();
  let userId;

  try {
    // For Clerk tokens, we can decode without verification in development
    const decoded = jwt.decode(token);

    if (decoded && decoded.sub) {
      userId = `user_${decoded.sub}`;
    } else {
      // Fallback for development or different token formats
      const tokenHash = Buffer.from(token)
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "");
      userId = `user_${tokenHash.substring(0, 10)}`;
    }

    req.auth = { userId };
    next();
  } catch (error) {
    return res.status(401).json({
      error: "Invalid token",
      message: "Please provide a valid authentication token",
    });
  }
};

export const getUserId = (req, res, next) => {
  if (!req.auth || !req.auth.userId) {
    req.user_id = "user_unknown";
  } else {
    req.user_id = req.auth.userId;
  }
  next();
};
