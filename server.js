const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const app = express();
const PORT = 3005;

// Middleware
app.use(bodyParser.json());

// MySQL Connection Configuration
const dbConfig = {
  host: "db",
  user: "root",
  password: "password",
  database: "user_data",
};

let dbConnection;

// Database connection function with retry logic
const connectWithRetry = async () => {
  const maxRetries = 5;
  let currentTry = 1;

  while (currentTry <= maxRetries) {
    try {
      console.log(
        `Attempting to connect to database (attempt ${currentTry}/${maxRetries})...`
      );
      dbConnection = await mysql.createConnection(dbConfig);
      console.log("Successfully connected to the database.");

      // Create table if it doesn't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255),
          email VARCHAR(255),
          age INT,
          weight FLOAT,
          height FLOAT,
          gender VARCHAR(50),
          dailyGoal INT,
          wakeupTime VARCHAR(50),
          sleepTime VARCHAR(50),
          latitude VARCHAR(50),
          longitude VARCHAR(50)
        )
      `;
      await dbConnection.query(createTableQuery);
      console.log("Users table verified/created successfully.");
      break;
    } catch (error) {
      console.error(
        `Database connection attempt ${currentTry} failed:`,
        error.message
      );
      if (currentTry === maxRetries) {
        throw new Error(
          `Failed to connect to database after ${maxRetries} attempts`
        );
      }
      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const waitTime = Math.min(1000 * Math.pow(2, currentTry), 32000);
      console.log(`Waiting ${waitTime / 1000} seconds before retry...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      currentTry++;
    }
  }
};

// Initialize database connection
(async () => {
  try {
    await connectWithRetry();
  } catch (error) {
    console.error(
      "Fatal error: Could not establish database connection:",
      error.message
    );
    process.exit(1); // Exit if we can't connect to the database
  }
})();

// Middleware to check database connection
const checkDbConnection = async (req, res, next) => {
  if (!dbConnection) {
    return res
      .status(503)
      .json({ error: "Database connection not established" });
  }
  try {
    // Ping the database to ensure the connection is still alive
    await dbConnection.ping();
    next();
  } catch (error) {
    console.error("Database connection lost. Attempting to reconnect...");
    try {
      await connectWithRetry();
      next();
    } catch (reconnectError) {
      return res.status(503).json({ error: "Database connection failed" });
    }
  }
};

// POST route to save or update user data
app.post("/user", checkDbConnection, async (req, res) => {
  try {
    const {
      name,
      email,
      age,
      weight,
      height,
      gender,
      dailyGoal,
      wakeupTime,
      sleepTime,
      latitude,
      longitude,
    } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }

    const updateQuery = `
      INSERT INTO users (
        id, name, email, age, weight, height, gender, 
        dailyGoal, wakeupTime, sleepTime, latitude, longitude
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        email = VALUES(email),
        age = VALUES(age),
        weight = VALUES(weight),
        height = VALUES(height),
        gender = VALUES(gender),
        dailyGoal = VALUES(dailyGoal),
        wakeupTime = VALUES(wakeupTime),
        sleepTime = VALUES(sleepTime),
        latitude = VALUES(latitude),
        longitude = VALUES(longitude)
    `;

    await dbConnection.query(updateQuery, [
      name,
      email,
      age,
      weight,
      height,
      gender,
      dailyGoal,
      wakeupTime,
      sleepTime,
      latitude,
      longitude,
    ]);

    res.status(200).json({
      message: "User data updated successfully.",
    });
  } catch (error) {
    console.error("Error updating user data:", error);
    res.status(500).json({
      error: "Internal server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// GET route to retrieve user data
app.get("/user/:id", checkDbConnection, async (req, res) => {
  try {
    const [rows] = await dbConnection.query(
      "SELECT * FROM users WHERE id = ?",
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    console.error("Error retrieving user data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/user/dummy", checkDbConnection, async (req, res) => {
  try {
    const dummyData = [
      [
        "John Doe",
        "johndoe@example.com",
        25,
        75.5,
        180.3,
        "Male",
        10000,
        "07:00",
        "22:00",
        "40.7128",
        "-74.0060",
      ],
      [
        "Jane Smith",
        "janesmith@example.com",
        30,
        65.0,
        165.0,
        "Female",
        8000,
        "06:30",
        "23:00",
        "34.0522",
        "-118.2437",
      ],
    ];

    const insertQuery = `
      INSERT INTO users (
        name, email, age, weight, height, gender,
        dailyGoal, wakeupTime, sleepTime, latitude, longitude
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const userData of dummyData) {
      await dbConnection.query(insertQuery, userData);
    }

    res.status(200).json({
      message: "Dummy user data inserted successfully.",
    });
  } catch (error) {
    console.error("Error inserting dummy data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// / route for health check
app.get("/", (req, res) => {
  res.status(200).json({ message: "Server is up and running!" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Something broke!",
    details: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle process termination
process.on("SIGTERM", async () => {
  console.log(
    "SIGTERM received. Closing HTTP server and database connection..."
  );
  if (dbConnection) {
    await dbConnection.end();
  }
  process.exit(0);
});
