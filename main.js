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
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')
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
    if (req.cookies._sreg_id) {
      req.session   = req.cookies._sreg_id
      const session = await mongo_client.db("signalregistry").collection("sessions").findOne({ _sreg_id: req.cookies._sreg_id }, {});
      if (session) req.user = { username: session.username, role: session.role }
    }
    else {
      let cookie_id      = crypto.randomBytes(16).toString("hex")
      let cookie_timeout = 30 * 24 * 60 * 60 * 1000
      req.session        = cookie_id
      req.cookie_created = (new Date()).toISOString()
      req.cookie_expire  = (new Date(Number(new Date())+cookie_timeout)).toISOString()
      res.cookie('_sreg_id', req.session, { domain: cookie_domain, maxAge: cookie_timeout, sameSite: 'none', secure: true });
      res.cookie('_sreg_cr', req.cookie_created, { domain: cookie_domain, maxAge: cookie_timeout, sameSite: 'none', secure: true });
      res.cookie('_sreg_ex', req.cookie_expire, { domain: cookie_domain, maxAge: cookie_timeout, sameSite: 'none', secure: true });
    }
    next()
  }
})

// Registry
express.get('/:coll', async (req, res) => {
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
express.get('/:coll/:name', async (req, res) => {
  const query = { owner: req.user ? req.user.username : req.session, name: req.params.name };
  res.send(await mongo_client.db("signalregistry").collection(req.params.coll).findOne(query))
})

express.put('/:coll/:name', async (req, res) => {
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
