/** Process supervisor for the HTTP service. Browser displays belong to profiles. */

import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const isWindows = os.platform() === 'win32';
const ipcDirectory = isWindows ? null : '/tmp/.agents/webai2api';
const IPC_PATH = isWindows
    ? '\\\\.\\pipe\\webai2api-supervisor'
    : path.join(ipcDirectory, 'supervisor.sock');
const RESTART_DELAY_MS = 1000;
const FATAL_EXIT_CODES = new Set([78]);

let serverProcess = null;
let ipcServer = null;
let restarting = false;
let stopping = false;
let currentArgs = process.argv.slice(2).filter(arg => arg !== '-xvfb' && arg !== '-vnc');

function log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} [${level}] [Supervisor] ${message}`);
}

function cleanupSocket() {
    if (!isWindows && fs.existsSync(IPC_PATH)) {
        try { fs.unlinkSync(IPC_PATH); } catch { }
    }
}

function startIpcServer() {
    if (ipcDirectory) fs.mkdirSync(ipcDirectory, { recursive: true });
    cleanupSocket();
    ipcServer = net.createServer(socket => {
        socket.once('data', data => {
            const command = data.toString().trim();
            if (command === 'RESTART' || command.startsWith('RESTART:')) {
                const encodedArgs = command.includes(':') ? command.slice(command.indexOf(':') + 1) : '';
                const args = encodedArgs.split(' ').filter(Boolean);
                socket.end('OK\n');
                restart(args);
            } else if (command === 'STOP') {
                socket.end('OK\n');
                shutdown();
            } else {
                socket.end('UNKNOWN_COMMAND\n');
            }
        });
    });
    ipcServer.on('error', error => log('ERROR', `IPC error: ${error.message}`));
    ipcServer.listen(IPC_PATH, () => log('INFO', `IPC listening at ${IPC_PATH}`));
}

function startServer() {
    const serverPath = path.join(process.cwd(), 'src', 'server', 'server.js');
    if (!fs.existsSync(serverPath)) {
        log('ERROR', `Missing server entry: ${serverPath}`);
        process.exit(1);
    }

    log('INFO', `Starting service${currentArgs.length ? ` (${currentArgs.join(' ')})` : ''}`);
    serverProcess = spawn(process.execPath, [serverPath, ...currentArgs], {
        cwd: process.cwd(),
        env: { ...process.env, SUPERVISOR_IPC: IPC_PATH },
        stdio: 'inherit'
    });
    serverProcess.once('error', error => {
        log('ERROR', `Service failed to start: ${error.message}`);
        process.exit(1);
    });
    serverProcess.once('exit', (code, signal) => {
        serverProcess = null;
        if (stopping) return finishShutdown();
        if (restarting) {
            restarting = false;
            setTimeout(startServer, RESTART_DELAY_MS);
            return;
        }
        if (FATAL_EXIT_CODES.has(code)) {
            log('ERROR', `Service stopped on a configuration error (${code})`);
            finishShutdown(code);
            return;
        }
        if (code !== 0 || signal) {
            log('WARN', `Service exited (${code ?? signal}); restarting`);
            setTimeout(startServer, RESTART_DELAY_MS);
            return;
        }
        finishShutdown(0);
    });
}

function restart(args = []) {
    if (restarting || stopping) return;
    restarting = true;
    currentArgs = args.filter(arg => arg !== '-xvfb' && arg !== '-vnc');
    log('INFO', 'Restarting service');
    if (serverProcess) serverProcess.kill('SIGTERM');
    else {
        restarting = false;
        setTimeout(startServer, RESTART_DELAY_MS);
    }
}

function shutdown() {
    if (stopping) return;
    stopping = true;
    log('INFO', 'Stopping service');
    if (serverProcess) serverProcess.kill('SIGTERM');
    else finishShutdown(0);
}

function finishShutdown(code = 0) {
    ipcServer?.close();
    cleanupSocket();
    process.exit(code);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', cleanupSocket);

startIpcServer();
startServer();
