const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// MySQL connection pool
const db = mysql.createPool({
  host: process.env.DB_HOST || 'mysql5045.site4now.net',
  user: process.env.DB_USER || 'ac838c_dbhus',
  password: process.env.DB_PASSWORD || 'Azerbaijan1918',
  database: process.env.DB_NAME || 'db_ac838c_dbhus',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000,
  keepAliveInitialDelay: 0
});

console.log('Connected to MySQL');

// Handle pool errors
db.on('error', (err) => {
  console.error('MySQL pool error:', err);
});

// Register endpoint
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Check if user exists
    const [rows] = await db.promise().query('SELECT id FROM users WHERE username = ?', [username]);
    if (rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await db.promise().query('INSERT INTO users (username) VALUES (?)', [username]);
    const userId = result.insertId;

    // Insert password
    await db.promise().query('INSERT INTO passwords (user_id, password) VALUES (?, ?)', [userId, hashedPassword]);

    res.json({ message: 'User registered successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Get user
    const [rows] = await db.promise().query('SELECT u.id, p.password FROM users u JOIN passwords p ON u.id = p.user_id WHERE u.username = ?', [username]);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'User not found. Please register first.' });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    res.json({ message: 'Login successful', userId: user.id, username });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.io for chat
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (username) => {
    socket.username = username;
    socket.join('chat');
    io.to('chat').emit('userJoined', username);
  });

  socket.on('sendMessage', async (data) => {
    const { message, userId } = data;
    try {
      await db.promise().query('INSERT INTO messages (user_id, message) VALUES (?, ?)', [userId, message]);
      io.to('chat').emit('message', { username: socket.username, message });
    } catch (error) {
      console.error(error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    io.to('chat').emit('userLeft', socket.username);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});