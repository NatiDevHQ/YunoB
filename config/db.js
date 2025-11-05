import { neon } from "@neondatabase/serverless";
import "dotenv/config";

// Enhanced database connection with timeout handling
let sql;
let isConnected = false;

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

// Test connection function with retry logic
export const testConnection = async (maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!sql) {
        sql = createConnection();
      }

      const result = await sql`SELECT 1 as test`;
      isConnected = true;
      console.log("✅ Database connection test successful");
      return { connected: true, result: result[0] };
    } catch (error) {
      console.error(
        `❌ Database connection test failed (attempt ${attempt}/${maxRetries}):`,
        error.message
      );

      if (attempt < maxRetries) {
        console.log(`🔄 Retrying in 3 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }

      isConnected = false;
      return { connected: false, error: error.message };
    }
  }
};

// Enhanced SQL wrapper with error handling
export const sqlWithRetry = async (query, params = [], maxRetries = 2) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!sql) {
        sql = createConnection();
      }

      const result = await sql(query, ...params);
      return result;
    } catch (error) {
      console.error(
        `❌ Database query failed (attempt ${attempt}/${maxRetries}):`,
        error.message
      );

      if (attempt < maxRetries) {
        console.log(`🔄 Retrying query in 2 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      throw error;
    }
  }
};

// Export the sql instance
export { sql };

export async function initDB() {
  try {
    // Test connection first
    const connectionTest = await testConnection();
    if (!connectionTest.connected) {
      throw new Error(`Database connection failed: ${connectionTest.error}`);
    }

    // Create tables...
    await sql`
            CREATE TABLE IF NOT EXISTS user_trials (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL UNIQUE,
                trial_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                trial_end_date TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

    await sql`
            CREATE TABLE IF NOT EXISTS payment_submissions (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                user_email VARCHAR(255),
                user_name VARCHAR(255),
                plan_id INTEGER,
                amount DECIMAL(10,2) NOT NULL,
                payment_method VARCHAR(50) NOT NULL,
                transaction_code VARCHAR(100) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                verified_at TIMESTAMP,
                verified_by VARCHAR(100),
                admin_notes TEXT,
                rejection_reason TEXT
            )
        `;

    await sql`
            CREATE TABLE IF NOT EXISTS user_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                plan_id INTEGER,
                status VARCHAR(20) DEFAULT 'active',
                start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                end_date TIMESTAMP,
                days_remaining INTEGER,
                trial_used BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

    await sql`
            CREATE TABLE IF NOT EXISTS subscription_plans (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                price DECIMAL(10,2) NOT NULL,
                duration_days INTEGER NOT NULL,
                features JSONB,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

    // Create default premium plan
    await sql`
            INSERT INTO subscription_plans (name, description, price, duration_days, features, is_active)
            VALUES (
                'Premium Plan',
                'Unlock all premium features including advanced analytics, unlimited products, and priority support',
                200.00,
                30,
                '["Advanced Analytics", "Unlimited Products", "Priority Support", "Data Export", "Custom Reports"]'::jsonb,
                true
            ) ON CONFLICT DO NOTHING
        `;

    console.log("✅ Database tables created successfully");
    return { success: true, message: "Database initialized successfully" };
  } catch (error) {
    console.error("❌ Error initializing database:", error);
    throw error;
  }
}
