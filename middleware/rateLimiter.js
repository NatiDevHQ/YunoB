import rateLimit from "express-rate-limit";

// General rate limiter for all endpoints
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for payment operations
export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // limit each IP to 5 payment attempts per hour
  message: {
    error: "Too many payment attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export default rateLimiter;
