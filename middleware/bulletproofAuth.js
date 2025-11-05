import { createClerkClient } from "@clerk/clerk-sdk-node";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

console.log("🔐 Clerk Auth - Ready");

/**
 * Clerk Authentication Middleware
 * Extracts and verifies Clerk user ID from requests
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication required",
        message: "Bearer token required in Authorization header",
      });
    }

    const token = authHeader.substring(7);

    // Verify the token with Clerk
    try {
      const session = await clerkClient.verifyToken(token);
      req.auth = { userId: session.sub };
      console.log("✅ Token verified for user:", session.sub);
      next();
    } catch (verifyError) {
      console.log("❌ Token verification failed:", verifyError.message);
      return res.status(401).json({
        error: "Invalid token",
        message: "Token verification failed",
      });
    }
  } catch (error) {
    console.error("🔑 Auth middleware error:", error);
    return res.status(500).json({
      error: "Authentication error",
      message: "Internal authentication failure",
    });
  }
};

/**
 * Extract and set user ID from authenticated request
 */
export const getUserId = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        error: "User ID not found",
        message: "Authentication data missing",
      });
    }

    req.clerk_user_id = req.auth.userId;
    console.log(`👤 Using Clerk user ID: ${req.clerk_user_id}`);
    next();
  } catch (error) {
    console.error("❌ User ID processing error:", error);
    return res.status(500).json({
      error: "User processing failed",
      message: "Failed to process user information",
    });
  }
};

/**
 * Admin check middleware using Clerk
 */
export const requireAdmin = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        error: "Authentication required",
        message: "Admin access requires authentication",
      });
    }

    // Get user from Clerk to check admin role
    const user = await clerkClient.users.getUser(req.auth.userId);

    // Check if user has admin role
    const isAdmin =
      user.publicMetadata?.role === "admin" ||
      user.privateMetadata?.isAdmin === true;

    if (!isAdmin) {
      return res.status(403).json({
        error: "Admin access required",
        message: "User does not have admin privileges",
      });
    }

    req.admin_id = req.auth.userId;
    console.log(`👑 Admin access granted: ${req.admin_id}`);
    next();
  } catch (error) {
    console.error("❌ Admin check error:", error);
    return res.status(500).json({
      error: "Admin verification failed",
      message: "Failed to verify admin privileges",
    });
  }
};
