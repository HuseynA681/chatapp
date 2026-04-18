# Chat App

A full-stack chat application with MySQL backend, user registration, and login.

## Setup

1. Install MySQL and create a database.

2. Run the schema.sql file to create tables:
   ```
   mysql -u root -p < db/schema.sql
   ```

3. Update the database credentials in server.js if necessary.

4. Install dependencies:
   ```
   npm install
   ```

5. Start the server:
   ```
   npm start
   ```

6. Open http://localhost:3000 in your browser.

## Features

- User registration and login
- Real-time chat using Socket.io
- Messages stored in MySQL database