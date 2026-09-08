import express from 'express';
import Database from 'better-sqlite3';

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).send({'message': 'SHIPTIVITY API. Read documentation to see API docs'});
});

// We are keeping one connection alive for the rest of the life application for simplicity
const db = new Database('./clients.db');

// Don't forget to close connection when server gets terminated
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Id can only be integer.',
      },
    };
  }
  const client = db.prepare('select * from clients where id = ? limit 1').get(id);
  if (!client) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Cannot find client with that id.',
      },
    };
  }
  return {
    valid: true,
  };
}

/**
 * Validate priority input
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if (Number.isNaN(priority)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid priority provided.',
      'long_message': 'Priority can only be positive integer.',
      },
    };
  }
  return {
    valid: true,
  }
}

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients, optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // status can only be either 'backlog' | 'in-progress' | 'complete'
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
    const clients = db.prepare('select * from clients where status = ?').all(status);
    return res.status(200).send(clients);
  }
  const statement = db.prepare('select * from clients');
  const clients = statement.all();
  return res.status(200).send(clients);
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }
  return res.status(200).send(db.prepare('select * from clients where id = ?').get(id));
});

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed
 * When priority is provided, the client priority will be changed with the rest of the clients accordingly
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No client on the same status should not have the same priority.
 * This API should return list of clients on success
 *
 * PUT /api/v1/clients/{client_id} - change the status of a client
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer,
 *
 */
app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }

  let { status, priority } = req.body;
  let clients = db.prepare('select * from clients').all();
  const client = clients.find(client => client.id === id);

  /* ---------- Update code below ----------*/

  // Validate status if provided
  if (status !== undefined && status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
    return res.status(400).send({
      message: 'Invalid status provided.',
      long_message: 'Status can only be one of the following: [backlog | in-progress | complete].',
    });
  }

  // Validate priority if provided
  if (priority !== undefined) {
    priority = parseInt(priority, 10);
    if (Number.isNaN(priority) || priority < 1) {
      return res.status(400).send({
        message: 'Invalid priority provided.',
        long_message: 'Priority can only be a positive integer.',
      });
    }
  }

  const oldStatus = client.status;
  const oldPriority = client.priority;

  // Nothing to do
  if (status === undefined && priority === undefined) {
    return res.status(200).send(clients);
  }

  const newStatus = status !== undefined ? status : oldStatus;
  const isNewLane = newStatus !== oldStatus;

  // Same lane, no explicit priority → no-op
  if (!isNewLane && priority === undefined) {
    return res.status(200).send(clients);
  }

  // Same lane, same priority → no-op
  if (!isNewLane && priority === oldPriority) {
    return res.status(200).send(clients);
  }

  // Step 1: Remove from old lane, shift down everyone below
  for (const c of clients) {
    if (c.id !== id && c.status === oldStatus && c.priority > oldPriority) {
      c.priority -= 1;
    }
  }

  // Step 2: Determine insertion point in target lane
  let insertAt;
  if (priority !== undefined) {
    insertAt = priority;
  } else {
    const maxPrio = Math.max(0, ...clients.filter(c => c.status === newStatus && c.id !== id).map(c => c.priority));
    insertAt = maxPrio + 1;
  }

  // Clamp to valid range
  const targetLaneSize = clients.filter(c => c.status === newStatus && c.id !== id).length;
  if (insertAt > targetLaneSize + 1) {
    insertAt = targetLaneSize + 1;
  }

  // Shift up everyone at or below insertAt in target lane
  for (const c of clients) {
    if (c.id !== id && c.status === newStatus && c.priority >= insertAt) {
      c.priority += 1;
    }
  }

  // Place the client
  client.status = newStatus;
  client.priority = insertAt;

  // Step 3: Persist all changes
  const updateStmt = db.prepare('UPDATE clients SET status = ?, priority = ? WHERE id = ?');
  const transaction = db.transaction(() => {
    for (const c of clients) {
      updateStmt.run(c.status, c.priority, c.id);
    }
  });
  transaction();

  return res.status(200).send(clients);
});

app.listen(3001);
console.log('app running on port ', 3001);
