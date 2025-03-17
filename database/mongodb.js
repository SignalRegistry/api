// =============================================================================
// Database 
// =============================================================================
const { MongoClient, ObjectId } = require("mongodb");

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const mongoClient = new MongoClient(`mongodb://${process.env.MONGODB_SERVER || "127.0.0.1"}:27017`, {
  // connectTimeoutMS: 1000,
  serverSelectionTimeoutMS: 5000,
  minPoolSize: 10,
  maxPoolSize: 20
});

let mongoOff = true
mongoClient.on('serverHeartbeatFailed', event => {
  if (!mongoOff) console.log("[ERROR] Database connection is offline.");
  mongoOff = true
});
mongoClient.on('serverHeartbeatSucceeded', event => {
  if (mongoOff) console.log("[INFO] Database connection is online.");
  mongoOff = false
});


async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await mongoClient.connect();
    mongoOff = false

    // Send a ping to confirm a successful connection
    await mongoClient.db("admin").command({ ping: 1 });

    console.log(`[INFO] Successfully connected to MongoDB at ${process.env.MONGODB_SERVER || "127.0.0.1"}`);
  } finally {
    // Ensures that the client will close when you finish/error
    await mongoClient.close();
  }
}
run().catch(() => {
  console.log("[INFO] Could not connected to MongoDB!");
});

module.exports.mongoClient = mongoClient;
module.exports.mongoOff    = mongoOff;