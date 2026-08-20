import fs from 'fs';
import net from 'net';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { logger } from '../../utils/logger.js';

function commandExists(command) {
    if (os.platform() === 'win32') return false;
    return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

function displayAvailable(number) {
    return !fs.existsSync(`/tmp/.X${number}-lock`) && !fs.existsSync(`/tmp/.X11-unix/X${number}`);
}

function findDisplay() {
    for (let number = 60; number < 160; number++) if (displayAvailable(number)) return number;
    throw new Error('没有可用的 Xvfb 显示号');
}

function portAvailable(port) {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, '127.0.0.1');
    });
}

async function findPort() {
    for (let port = 5900; port < 6100; port++) if (await portAvailable(port)) return port;
    throw new Error('没有可用的 VNC 端口');
}

async function waitForDisplay(number, timeout = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        if (fs.existsSync(`/tmp/.X11-unix/X${number}`)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Xvfb :${number} 未就绪`);
}

export class DisplaySession {
    constructor(profileId, options = {}) {
        this.profileId = profileId;
        this.enabled = options.enabled !== false && options.headless !== true;
        this.display = null;
        this.port = 0;
        this.xvfb = null;
        this.vnc = null;
    }

    async start() {
        if (!this.enabled || os.platform() !== 'linux') return this.info();
        if (!commandExists('Xvfb')) throw new Error('系统缺少 Xvfb');
        const number = findDisplay();
        this.display = `:${number}`;
        this.xvfb = spawn('Xvfb', [this.display, '-screen', '0', '1366x768x24', '-ac', '-nolisten', 'tcp'], { stdio: 'ignore' });
        this.xvfb.once('error', error => logger.error('显示器', `[${this.profileId}] Xvfb 启动失败: ${error.message}`));
        await waitForDisplay(number);

        if (commandExists('x11vnc')) {
            this.port = await findPort();
            this.vnc = spawn('x11vnc', [
                '-display', this.display,
                '-rfbport', String(this.port),
                '-localhost', '-nopw', '-shared', '-forever', '-noxdamage', '-norc',
                '-geometry', '1366x768'
            ], { stdio: 'ignore' });
            this.vnc.once('error', error => {
                this.port = 0;
                logger.error('显示器', `[${this.profileId}] VNC 启动失败: ${error.message}`);
            });
            this.vnc.once('exit', () => { this.port = 0; });
        }
        logger.info('显示器', `[${this.profileId}] ${this.display} / VNC ${this.port || 'disabled'}`);
        return this.info();
    }

    info() {
        return {
            profileId: this.profileId,
            enabled: Boolean(this.port),
            display: this.display || '',
            port: this.port,
            isolated: Boolean(this.display)
        };
    }

    async stop() {
        for (const child of [this.vnc, this.xvfb]) {
            if (child && !child.killed) child.kill('SIGTERM');
        }
        this.vnc = null;
        this.xvfb = null;
        this.port = 0;
        this.display = null;
    }
}
