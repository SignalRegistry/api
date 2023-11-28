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
const express = require('express')();
const { WebSocketServer } = require('ws');

// Http and Websocket Server
const port      = 3000
const server    = http.createServer(express)
const websocket = new WebSocketServer({ server: server });
server.listen(port, () => {
  console.log(`[INFO] HTTP server is listening at port ${port}`)
});

// Middlewares
let morg = require('morgan')
morg.token('session', function (req, res) { return req.session || req.token || 'no-session'.padEnd(32, '#') })
morg.token('username', function (req, res) { return  (req.user && req.user['username']) ? req.user['username'].padEnd(16, '_') : 'no-user'.padEnd(16, '#') })
express.use(morg('[LOG] :method :status :response-time :req[content-length] :res[content-length] :session :username :url'))

express.use(require('body-parser').urlencoded({ extended: true }));
express.use(require('body-parser').json())
express.use(require('cookie-parser')())

express.use(async function (req, res, next) {
  // if (req.headers['content-type'] != 'application/json') {
  //   res.status(400).send('INVALID_CONTENT_TYPE')
  //   return;
  // }
  let cookie_domain = '.signalregistry.net'
  if(req.hostname != "api.signalregistry.net"){
    res.set('Access-Control-Allow-Origin', req.headers.origin)
    res.set('Access-Control-Allow-Credentials', 'true')
    cookie_domain = '127.0.0.1'
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
    if (req.cookies.sreg) {
      req.session   = req.cookies.sreg
      const session = await mongo_client.db("signalregistry").collection("sessions").findOne({ sreg: req.cookies.sreg }, {});
      if (session) req.user = { username: session.username, role: session.role }
    }
    else {
      let cookie_id      = crypto.randomBytes(16).toString("hex")
      let cookie_timeout = 1 * 24 * 60 * 60 * 1000
      req.session        = cookie_id
      req.cookie_created = (new Date()).toISOString()
      req.cookie_expire  = (new Date(Number(new Date())+cookie_timeout)).toISOString()
      res.cookie('sreg', req.session, { domain: cookie_domain, maxAge: cookie_timeout, sameSite: 'none', secure: true });
      res.cookie('srcr', req.cookie_created, { domain: cookie_domain, maxAge: cookie_timeout, sameSite: 'none', secure: true });
      res.cookie('srex', req.cookie_expire, { domain: cookie_domain, maxAge: cookie_timeout, sameSite: 'none', secure: true });
    }
    next()
  }
})

// Registry
express.get('/:coll', async (req, res) => {
  const query  = { owner: req.user ? req.user.username : req.session };
  const result = await mongo_client.db("signalregistry").collection(req.params.coll).find(query);
  res.send(result.toArray())
})

// Registry Data
express.get('/:coll/:name', async (req, res) => {
  const query = { owner: req.user ? req.user.username : req.session, name: req.params.name };
  const exist = await mongo_client.db("signalregistry").collection(req.params.coll).countDocuments(query)
  if (exist == 0)
    res.status(404).send('[ERROR] Signal not found.')
  else {
    const result = await mongo_client.db("signalregistry").collection(req.params.coll).findOne(query);
    res.send(result)
  }
})

express.post('/:coll/:name', async (req, res) => {
  if (req.params.coll == 'list'
    && req.body
    && (Array.isArray(req.body) && (typeof req.body[0] == 'string' || typeof req.body[0] == 'number'))) {
    const item  = { owner: req.user ? req.user.username : req.session, name: req.params.name };
    const exist = await mongo_client.db("signalregistry").collection("list").countDocuments(item)
    if (exist > 0)
      res.status(406).send('[ERROR] Duplicate signal name, use PUT request to update signal.')
    else {
      item.data        = req.body
      item.create_date = new Date().toISOString()
      const option     = {};
      const result     = await mongo_client.db("signalregistry").collection("list").insertOne(item, option);
      res.send(result.acknowledged)
    }
  }
  else {
    res.status(406).send('[ERROR] Unidentified signal type.')
  }
})

express.put('/:coll/:name', async (req, res) => {
  if (req.params.coll == 'list'
    && req.body
    && (Array.isArray(req.body) && (typeof req.body[0] == 'string' || typeof req.body[0] == 'number'))) {
    const item  = { owner: req.user ? req.user.username : req.session, name: req.params.name };
    const exist = await mongo_client.db("signalregistry").collection("list").countDocuments(item)
    if (exist == 0)
      res.status(404).send('[ERROR] Signal not found, create signal first with POST request.')
    else {
      const query  = { owner: req.user ? req.user.username : req.session, name: req.params.name };
      const update = { $set: { last_update: new Date().toISOString() }, $push: { 'data': { $each: req.body } } }
      const option = {};
      const result = await mongo_client.db("signalregistry").collection("list").updateOne(query, update, option);
      res.send(result.acknowledged)
    }
  }
  else {
    res.status(406).send('[ERROR] Unidentified signal type.')
  }
})

express.delete('/:coll/:name', async (req, res) => {
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
express.get('/', function (req, res) {
  // res.send({ session: req.session })
  let used_memory = process.memoryUsage()
  for (let item of Object.keys(used_memory)) {
    used_memory[item] = `${Math.round(used_memory[item] / 1024 / 1024 * 100) / 100}MB`;
  }
  res.send(Object.assign(req.headers, req.user, { 'used_memory': used_memory }))
})
