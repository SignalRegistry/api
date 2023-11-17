// -----------------------------------------------------------------------------
// Built-in Modules
// -----------------------------------------------------------------------------
const path = require('path')
const http = require('http');
const asrt = require("assert")
const cryp = require('crypto')


// =============================================================================
// Database 
// =============================================================================
const { MongoClient, ServerApiVersion } = require("mongodb");

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const mgcl = new MongoClient('mongodb://127.0.0.1:27017', {
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

let mgof = true
mgcl.on('serverHeartbeatFailed', event => {
  if (!mgof) console.log("[ERROR] Database connection is offline.");
  mgof = true
});
mgcl.on('serverHeartbeatSucceeded', event => {
  if (mgof) console.log("[INFO] Database connection is online.");
  mgof = false
});

let mgdb;

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await mgcl.connect();
    mgof = false

    // Send a ping to confirm a successful connection
    await mgcl.db("admin").command({ ping: 1 });

    mgdb = mgcl.db('signalregistry')

  } finally {
    console.log("[INFO] Successfully connected to MongoDB!");
  }
}
run().catch(() => {
  console.log("[INFO] Could not connected to MongoDB!");
});


// =============================================================================
// Server
// =============================================================================
const expr = require('express')();
const { WebSocketServer } = require('ws');

// Http and Websocket Server
const port = 3000
const serv = http.createServer(expr)
const webs = new WebSocketServer({ server: serv });
serv.listen(port, () => {
  console.log(`[INFO] HTTP server is listening at port ${port}`)
});

// Middlewares
let morg = require('morgan')
morg.token('sess', function (req, res) { return req.sess || 'no-session'.padEnd(32, '#') })
morg.token('toke', function (req, res) { return req.toke || 'no-token'.padEnd(12, '#') })
morg.token('usna', function (req, res) { return (req.user) ? req.user['unme'].padEnd(16, '_') : 'no-user'.padEnd(16, '#') })
expr.use(morg('[LOG] :method :status :response-time :req[content-length] :res[content-length] :sess :toke :usna :url'))

expr.use(require('body-parser').urlencoded({ extended: true }));
expr.use(require('body-parser').json())
expr.use(require('cookie-parser')())

expr.use(async function (req, res, next) {
  // if (req.headers['content-type'] != 'application/json') {
  //   res.status(400).send('INVALID_CONTENT_TYPE')
  //   return;
  // }
  if(req.host != "api.signalregistry.net"){
    res.set('Access-Control-Allow-Origin', req.headers.origin)
    res.set('Access-Control-Allow-Credentials', 'true')
  }
  if (mgof) {
    res.status(404).send('DATABASE_OFF')
    return;
  }
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    req.toke = req.headers.authorization.replace('Bearer ', '')
    // console.log(`[DEBUG]: Bearer token supplied: ${req.toke}`)
    next()
  }
  else {
    if (req.cookies.sreg) {
      req.sess = req.cookies.sreg
      const sess = await mgcl.db("signalregistry").collection("sessions").findOne({ sreg: req.cookies.sreg }, {});
      if (sess) req.user = { unme: sess.unme, role: sess.role }
    }
    else {
      let coid = cryp.randomBytes(16).toString("hex")
      let coag = 1 * 24 * 60 * 60 * 1000
      req.sess = coid
      req.secr = (new Date()).toISOString()
      req.seex = (new Date(Number(new Date())+coag)).toISOString()
      res.cookie('sreg', req.sess, { domain:'.signalregistry.net', maxAge: coag, sameSite: 'none', secure: true });
      res.cookie('srcr', req.secr, { domain:'.signalregistry.net', maxAge: coag, sameSite: 'none', secure: true });
      res.cookie('srex', req.seex, { domain:'.signalregistry.net', maxAge: coag, sameSite: 'none', secure: true });
    }
    next()
  }
})




// Registry
expr.get('/:coll', async (req, res) => {
  const qery = { ownr: req.user ? req.user.unme : req.sess };
  const rslt = await mgcl.db("signalregistry").collection(req.params.coll).find(qery);
  res.send(rslt.toArray())
})

// Registry Data
expr.get('/:coll/:name', async (req, res) => {
  const qery = { ownr: req.user ? req.user.unme : req.sess, name: req.params.name };
  const exst = await mgcl.db("signalregistry").collection(req.params.coll).countDocuments(qery)
  if (exst == 0)
    res.status(404).send('[ERROR] Signal not found.')
  else {
    const rslt = await mgcl.db("signalregistry").collection(req.params.coll).findOne(qery);
    res.send(rslt)
  }
})

expr.post('/:coll/:name', async (req, res) => {
  if (req.params.coll == 'list'
    && req.body
    && (Array.isArray(req.body) && (typeof req.body[0] == 'string' || typeof req.body[0] == 'number'))) {
    const item = { ownr: req.user ? req.user.unme : req.sess, name: req.params.name };
    const exst = await mgcl.db("signalregistry").collection("list").countDocuments(item)
    if (exst > 0)
      res.status(406).send('[ERROR] Duplicate signal name, use PUT request to update signal.')
    else {
      item.data = req.body
      item.cdte = new Date().toISOString()
      const opti = {};
      const rslt = await mgcl.db("signalregistry").collection("list").insertOne(item, opti);
      res.send(rslt.acknowledged)
    }
  }
  else {
    res.status(406).send('[ERROR] Unidentified signal type.')
  }
})

expr.put('/:coll/:name', async (req, res) => {
  if (req.params.coll == 'list'
    && req.body
    && (Array.isArray(req.body) && (typeof req.body[0] == 'string' || typeof req.body[0] == 'number'))) {
    const item = { ownr: req.user ? req.user.unme : req.sess, name: req.params.name };
    const exst = await mgcl.db("signalregistry").collection("list").countDocuments(item)
    if (exst == 0)
      res.status(404).send('[ERROR] Signal not found, create signal first with POST request.')
    else {
      const qery = { ownr: req.user ? req.user.unme : req.sess, name: req.params.name };
      const updt = { $set: { udte: new Date().toISOString() }, $push: { 'data': { $each: req.body } } }
      const opti = {};
      const rslt = await mgcl.db("signalregistry").collection("list").updateOne(qery, updt, opti);
      res.send(rslt.acknowledged)
    }
  }
  else {
    res.status(406).send('[ERROR] Unidentified signal type.')
  }
})

expr.delete('/:coll/:name', async (req, res) => {
  const qery = { ownr: req.user ? req.user.unme : req.sess, name: req.params.name };
  const exst = await mgcl.db("signalregistry").collection(req.params.coll).countDocuments(qery)
  if (exst == 0)
    res.status(404).send('[ERROR] Signal not found.')
  else {
    const rslt = await mgcl.db("signalregistry").collection(req.params.coll).deleteOne(qery);
    res.send(rslt.acknowledged)
  }
})


// Endpoints
expr.get('/', function (req, res) {
  // res.send({ sess: req.sess })
  let usme = process.memoryUsage()
  for (let item of Object.keys(usme)) {
    usme[item] = `${Math.round(usme[item] / 1024 / 1024 * 100) / 100}MB`;
  }
  res.send(Object.assign(req.headers, req.user, { 'usme': usme }))
})

/*
Abbreviations:
coid: cookie id
coag: cookie age
sess: session
secr: session create date
seex: session expire date

usna: username
usme: used memory
qery: query
updt: update
opti: option
rslt: result
exst: exist
*/



