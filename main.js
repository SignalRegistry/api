// -----------------------------------------------------------------------------
// Built-in Modules
// -----------------------------------------------------------------------------
const path   = require('path')
const http   = require('http');
const assert = require("assert")
const crypto = require('crypto')


// =============================================================================
// Database 
// =============================================================================
const { MongoClient, ServerApiVersion } = require("mongodb");

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const mongo_client = new MongoClient('mongodb://127.0.0.1:27017', {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // connectTimeoutMS: 1000,
  serverSelectionTimeoutMS: 5000,
  minPoolSize: 10,
  maxPoolSize: 20
});

let mongo_off = true
mongo_client.on('serverHeartbeatFailed', event => {
  if (!mongo_off) console.log("[ERROR] Database connection is offline.");
  mongo_off = true
});
mongo_client.on('serverHeartbeatSucceeded', event => {
  if (mongo_off) console.log("[INFO] Database connection is online.");
  mongo_off = false
});

let mongo_database;

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await mongo_client.connect();
    mongo_off = false

    // Send a ping to confirm a successful connection
    await mongo_client.db("admin").command({ ping: 1 });

    mongo_database = mongo_client.db('signalregistry')
    console.log("[INFO] Successfully connected to MongoDB!");
  } finally {
    ;
  }
}
run().catch(() => {
  console.log("[INFO] Could not connected to MongoDB!");
});


// =============================================================================
// Server
// =============================================================================
const app = require('express')();
const { WebSocketServer } = require('ws');

// Http and Websocket Server
const port      = 7339
const server    = http.createServer(app)
const websocket = new WebSocketServer({ server: server });
server.listen(port, () => {
  console.log(`[INFO] HTTP server is listening at port ${port}`)
});

// Middlewares
let morg = require('morgan')
morg.token('session', function (req, res) { return req.session || req.token || 'no-session'.padEnd(32, '#') })
morg.token('username', function (req, res) { return  (req.user && req.user['username']) ? req.user['username'].padEnd(16, '_') : 'no-user'.padEnd(16, '#') })
app.use(morg('[LOG] :method :status :response-time :req[content-length] :res[content-length] :session :username :url'))

app.use(require('express').urlencoded({ extended: true }));
app.use(require('cookie-parser')())
app.use(require('express').json())
app.use(require('helmet')())

app.use(async function (req, res, next) {
  if(req.hostname != "api.signalregistry.net"){
    res.set('Access-Control-Allow-Origin', req.headers.origin)
    res.set('Access-Control-Allow-Credentials', 'true')
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')
  }
  
  if (mongo_off) {
    res.status(404).send('DATABASE_OFF')
    return;
  }
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    req.token = req.headers.authorization.replace('Bearer ', '')
    // console.log(`[DEBUG]: Bearer token supplied: ${req.token}`)
    next()
  }
  else {
    if (req.query.sessionId) {
      req.session   = req.query.sessionId
      const session = await mongo_client.db("signalregistry").collection("sessions").findOne({ id: req.session }, {});
      if (session) req.user = { username: session.username, role: session.role }
    }
    else {
      req.session = null
    }
    next()
  }
})

// Registry
app.get('/:coll', async (req, res) => {
  const pipeline   = [
    { "$match"   : { owner: !req.user ? req.session : req.user.role !="admin" ? req.user.username : {} } },
    { "$project" : { _id : 0 } },
    { "$project" : { 
      owner       : 1,
      name        : 1,
      create_date : 1,
      last_update : 1,
      count       : { $size: "$data" },
      types       : { 
        $reduce: {
          input        : "$data" ,
          initialValue : [],
          in           : 
          {
            $concatArrays : [ 
              "$$value", 
              { "$cond": {
                    if   : { $in: [ { $type : "$$this"}, "$$value" ] },
                    then : [],
                    else : [{ $type : "$$this"}]
                  }
              }
            ]
          }
        }
      }
    }},
  ]
  const result     = mongo_client.db("signalregistry").collection(req.params.coll).aggregate(pipeline);
  res.send(await result.toArray())
})

// Registry Data
app.get('/:coll/:name', async (req, res) => {
  const query = { owner: req.user ? req.user.username : req.session, name: req.params.name };
  res.send(await mongo_client.db("signalregistry").collection(req.params.coll).findOne(query))
})

app.put('/:coll/:name', async (req, res) => {
  if (req.params.coll == 'list'
    && req.body
    && (Array.isArray(req.body.data) && (typeof req.body.data[0] == 'string' || typeof req.body.data[0] == 'number'))) {
    const item  = { owner: req.user ? req.user.username : req.session, name: req.params.name };
    const exist = await mongo_client.db("signalregistry").collection("list").countDocuments(item)
    let update, option
    if (exist == 0){
      item.data = req.body.data
      update    = { "$currentDate": { "create_date": true, "last_update": true }, "$set": item }
      option    = { upsert: true }
    }
    else {
      update = { "$currentDate": { "last_update": true } , $push: { 'data': { $each: req.body.data } } }
      option = {} 
    }
    const result = await mongo_client.db("signalregistry").collection("list").updateOne(item, update, option);
    res.send(result.acknowledged)
  }
  else {
    res.status(406).send('[ERROR] Unidentified signal type.')
  }
})

app.delete('/:coll/:name', async (req, res) => {
  const query = { owner: req.user ? req.user.username : req.session, name: req.params.name };
  const exist = await mongo_client.db("signalregistry").collection(req.params.coll).countDocuments(query)
  if (exist == 0)
    res.status(404).send('[ERROR] Signal not found.')
  else {
    const result = await mongo_client.db("signalregistry").collection(req.params.coll).deleteOne(query);
    res.send(result.acknowledged)
  }
})

// Endpoints
app.get('/', function (req, res) {
  // res.send({ session: req.session })
  let used_memory = process.memoryUsage()
  for (let item of Object.keys(used_memory)) {
    used_memory[item] = `${Math.round(used_memory[item] / 1024 / 1024 * 100) / 100}MB`;
  }
  res.send(Object.assign(req.headers, {session: req.session}, { 'used_memory': used_memory }))
})
