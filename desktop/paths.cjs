// Where the desktop app keeps things. <userData> is ~/Library/Application Support/TicketForge on
// macOS and %APPDATA%\TicketForge on Windows.
'use strict';

const { app } = require('electron');
const path = require('node:path');

const APP_NAME = 'TicketForge';
// Before getPath('userData'), which is named after the app.
app.setName(APP_NAME);

const USER_DIR = app.getPath('userData');
const LOG_DIR = path.join(USER_DIR, 'logs');

module.exports = {
  APP_NAME,
  /** The project folder (inside the app when packaged). */
  ROOT: path.resolve(__dirname, '..'),
  USER_DIR,
  /** Built-in database, secret key, folders. */
  DATA_DIR: path.join(USER_DIR, 'data'),
  /** Settings, same keys as .env.example. */
  ENV_FILE: path.join(USER_DIR, 'ticketforge.env'),
  /** Small things the app remembers between launches (e.g. that the terminal was introduced). */
  STATE_FILE: path.join(USER_DIR, 'desktop-state.json'),
  LOG_DIR,
  LOG_FILE: path.join(LOG_DIR, 'server.log'),
};
