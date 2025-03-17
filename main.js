// -----------------------------------------------------------------------------
// Built-in Modules
// -----------------------------------------------------------------------------
const path      = require('path')
const http      = require('http');
const assert    = require("assert")
// const buffer    = require("Buffer")
const crypto    = require('crypto')
const { spawn } = require('node:child_process');

const { mongoClient, mongoOff } = require("./database/mongodb.js");



// =============================================================================
// HTTP Server
// =============================================================================
const app = require('express')();

// Http and Websocket Server
const port      = 7339
const server    = http.createServer(app)
server.listen(port, () => {
  console.log(`[INFO] HTTP server is listening at port ${port}`)
});

// Middlewares
let morgan = require('morgan')
morgan.token('session', function (req, res) { return req.session || req.token || 'no-session'.padEnd(32, '#') })
morgan.token('username', function (req, res) { return  (req.user && req.user['username']) ? req.user['username'].padEnd(16, '_') : 'no-user'.padEnd(16, '#') })
app.use(morgan('[LOG] :method :status :response-time :req[content-length] :res[content-length] :session :username :url'))

app.use(require('express').urlencoded({ extended: true }));
app.use(require('cookie-parser')())
app.use(require('express').json())
app.use(require('cors')())
app.use(require('helmet')())

app.use(async function (req, res, next) {
  
  if (mongoOff) {
    console.log(`[ERROR] Database is offline`)
    res.send({})
  }

  else if (req.query.sessionId) {
    req.session   = req.query.sessionId
    const session = await mongoClient.db("signalregistry").collection("sessions").findOne({ 
      sessionId: req.session 
    }, {});
    if (session) req.user = { username: session.username, role: session.role }
    else {
      const session = {
        sessionId: req.session,
        username : `guest${crypto.randomBytes(16).toString("hex")}`,
        role     : `guest`
      }
      const result = await mongoClient.db("signalregistry").collection("sessions").insertOne(session)
      req.user = result.insertedId ? { username: session.username, role: session.role } : { username: "guest", role: "anonymous" }
    }
    next()
  }
  // else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
  //   req.session = req.headers.authorization.replace('Bearer ', '')
  //   // console.log(`[DEBUG]: Bearer token supplied: ${req.token}`)
  //   next()
  // }
  else{
    console.log(`[WARN] Request without session id.`)
    res.send({})
  }
})

// -----------------------------------------------------------------------------
// HTTP Server: Login
// -----------------------------------------------------------------------------
app.post('/login', async (req, res) => {
  await mongoClient.db("signalregistry").collection("sessions").deleteMany({ sessionId: req.session }, {});
  await mongoClient.db("signalregistry").collection("sessions").deleteMany({ username: req.user.username }, {});
  
  if(req.body.email && req.body.password) {
    
    const user = await mongoClient.db("signalregistry").collection("users").findOne({ 
      email   : req.body.email, 
      password: req.body.password
    }, {});
    await mongoClient.db("signalregistry").collection("sessions").deleteMany({ username: user ? user.username : undefined }, {});
  
    if(user) {
      const result = await mongoClient.db("signalregistry").collection("sessions").insertOne({
        username : user.username,
        sessionId: req.session,
        role     : user.role
      });
      res.send({ username: user.username, role: user.role })
    }
    else {
      res.send({})
    }
  }
  else res.send({})
})

app.get('/logout', async (req, res) => {
  await mongoClient.db("signalregistry").collection("sessions").deleteMany({ sessionId: req.session }, {});
  await mongoClient.db("signalregistry").collection("sessions").deleteMany({ username: req.user.username }, {});
  res.send({})
})

// -----------------------------------------------------------------------------
// HTTP Server: User
// -----------------------------------------------------------------------------
app.get('/user', async (req, res) => {
  res.send(req.user)
})

// -----------------------------------------------------------------------------
// HTTP Server: Source
// -----------------------------------------------------------------------------
app.get('/collections', async (req, res) => {
  res.send(await mongoClient.db("signalregistry").collection("sourceTemplates").find({}).toArray())
})

// -----------------------------------------------------------------------------
// HTTP Server: Registry
// -----------------------------------------------------------------------------
app.get('/registry', async (req, res) => {
  const query = { owner: req.user ? req.user.username : req.session };
  res.send(await mongoClient.db("signalregistry").collection("registry").find(query).toArray())
})

app.post('/registry', async (req, res) => {
  const item  = { owner : req.user ? req.user.username : req.session, 
                  name  : req.body.name,
                  type  : req.body.type,
                  desc  : req.body.desc || "Description will be added soon." 
                };
                let update, option
  update    = { "$currentDate": { "create_date": true }, "$set": item }
  option    = { upsert: true }
  const result = await mongoClient.db("signalregistry").collection("registry").updateOne(item, update, option);
  res.send(result.upsertedId || null)
})

// -----------------------------------------------------------------------------
// HTTP Server: Registry: Item
// -----------------------------------------------------------------------------
app.get('/registry/:item', async (req, res) => {
  res.send(await mongoClient.db("signalregistry").collection("registry").findOne({_id: (new ObjectId(req.params.item))}))
})

// -----------------------------------------------------------------------------
// HTTP Server: Registry: Item: Data
// -----------------------------------------------------------------------------
app.put('/registry/:item/data', async (req, res) => {
  if(Array.isArray(req.body.data) && req.body.data.length > 0) {
    const pipeline = [
      // { "$match" : {} }
      // { "$match" : { owner: !req.user ? req.session : req.user.role !="admin" ? req.user.username : {} } },
      { "$match" : { _id :  (new ObjectId(req.params.item)) } },
      { "$limit" : 1 },
      { "$project" : { _id : 0 } },
      { "$project" : { type: 1 } }
    ]
    const type = (await mongoClient.db("signalregistry").collection("registry").aggregate(pipeline).toArray())[0].type
    console.log(`[DEBUG] Registry item type is ${type}`)
    if(type == "trigger") {
      if(req.body.data.length != 1) {
        res.send({
          error: {
            endpoint: "/registry/:item/data",
            method  : "PUT",
            message : "DATA_LENGTH_EXCEED"
          }
        })
      }
      else if(req.body.data[0] != 1) {
        res.send({
          error: {
            endpoint: "/registry/:item/data",
            method  : "PUT",
            message : "INCONSISTENT_DATA"
          }
        })
      }
      else {
        const item = { 
          _id :  (new ObjectId(req.params.item)),
          owner: !req.user ? req.session : req.user.role !="admin" ? req.user.username : {} 
        }
        log.info(item)
        // const update = { "$currentDate": { "last_update": true } , $push: { 'data': { "value": req.body.data[0], "date" : new Date() } } } 
        const update = { $push: { 'data': { "value": req.body.data[0], "date" : new Date(), "location": "" } } } 
        const option = {} 
        const result = await mongoClient.db("signalregistry").collection("registry").updateOne(item, update, option);
        // const result = await mongoClient.db("signalregistry").collection("registry").updateOne(item, update, option);
        // const update2 = { $set: { "$currentDate": { "$last": true } } }
        // await mongoClient.db("signalregistry").collection("registry").updateOne(item, update2, option);
        res.send(result)
      }
    }
    // res.send((await mongoClient.db("signalregistry").collection("registry").aggregate(pipeline)).toArray())
    // res.send((await mongoClient.db("signalregistry").collection("registry").aggregate(pipeline).toArray())[0])

  }
  else {
    res.send({
      error: {
        endpoint: "/registry/:item/data",
        method  : "PUT",
        message : "NO_DATA"
      }
    })
  }
})



// Registry
app.get('/:coll', async (req, res) => {
  const pipeline = [
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
  const result = mongoClient.db("signalregistry").collection(req.params.coll).aggregate(pipeline);
  res.send(await result.toArray())
})

// Registry Data
app.get('/:coll/:name', async (req, res) => {
  const query = { owner: req.user ? req.user.username : req.session, name: req.params.name };
  res.send(await mongoClient.db("signalregistry").collection(req.params.coll).findOne(query))
})

app.put('/:coll/:name', async (req, res) => {
  if (req.params.coll == 'list') {
    if (!Object.keys(req.body).length) {
      const item  = { owner: req.user ? req.user.username : req.session, name: req.params.name };
      item.data = []
      let update, option
      update    = { "$currentDate": { "create_date": true, "last_update": true }, "$set": item }
      option    = { upsert: true }
      const result = await mongoClient.db("signalregistry").collection("list").updateOne(item, update, option);
      res.send(result.acknowledged)
    }
    else if(req.body
      && (Array.isArray(req.body.data) && (typeof req.body.data[0] == 'string' || typeof req.body.data[0] == 'number'))) {
      const item  = { owner: req.user ? req.user.username : req.session, name: req.params.name };
      const exist = await mongoClient.db("signalregistry").collection("list").countDocuments(item)
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
      const result = await mongoClient.db("signalregistry").collection("list").updateOne(item, update, option);
      res.send(result)
    }
  }
  else {
    res.status(406).send('[ERROR] Unidentified signal type.')
  }
})

app.delete('/:coll/:name', async (req, res) => {
  const query = { owner: req.user ? req.user.username : req.session, name: req.params.name };
  const exist = await mongoClient.db("signalregistry").collection(req.params.coll).countDocuments(query)
  if (exist == 0)
    res.status(404).send('[ERROR] Signal not found.')
  else {
    const result = await mongoClient.db("signalregistry").collection(req.params.coll).deleteOne(query);
    res.send(result)
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

// =============================================================================
// Websocket Server
// =============================================================================
const { WebSocketServer } = require('ws');

const websocket = new WebSocketServer({ server: server });
