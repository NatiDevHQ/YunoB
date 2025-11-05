import { neon } from "@neondatabase/serverless";
import "dotenv/config";

// Database connection
let sql;

const createConnection = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return neon(process.env.DATABASE_URL);
};

// Initialize connection
try {
  sql = createConnection();
  console.log("✅ Database connection initialized");
} catch (error) {
  console.error("❌ Failed to initialize database connection:", error.message);
  sql = null;
}

// Test connection
export const testConnection = async (maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!sql) sql = createConnection();
      const result = await sql`SELECT 1 as test`;
      console.log("✅ Database connection test successful");
      return { connected: true, result: result[0] };
    } catch (error) {
      console.error(
        `❌ Database connection test failed (attempt ${attempt}/${maxRetries}):`,
        error.message
      );
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      return { connected: false, error: error.message };
    }
  }
};

export { sql };

export async function initDB() {
  try {
    const connectionTest = await testConnection();
    if (!connectionTest.connected) {
      throw new Error(`Database connection failed: ${connectionTest.error}`);
    }

    // Create users table with pro status
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        clerk_user_id TEXT NOT NULL UNIQUE,
        email VARCHAR(255),
        name VARCHAR(255),
        is_pro BOOLEAN DEFAULT false,
        pro_since TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create payments table for one-time payments
    await sql`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        clerk_user_id TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        transaction_id TEXT NOT NULL UNIQUE,
        status VARCHAR(20) DEFAULT 'pending',
        admin_id TEXT,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      )
    `;

    console.log("✅ Database tables created successfully");
    return { success: true, message: "Database initialized successfully" };
  } catch (error) {
    console.error("❌ Error initializing database:", error);
    throw error;
  }
}
