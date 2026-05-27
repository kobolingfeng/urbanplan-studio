import { isAbsolute, relative, resolve } from 'path';

export function resolveDevPort(value: unknown, fallback = 3000): number {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && decimalIntegerPattern.test(value.trim())
            ? Number(value.trim())
            : fallback;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
    return parsed;
}

const decimalIntegerPattern = /^\d+$/;

export function splitCommandLine(command: string): string[] {
    const source = String(command ?? '');
    const parts: string[] = [];
    let current = '';
    let quote: '"' | "'" | undefined;
    let hasToken = false;
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];
        if (char === '\\' && next && (next === '"' || next === "'" || next === '\\' || /\s/.test(next))) {
            current += next;
            hasToken = true;
            index++;
            continue;
        }
        if ((char === '"' || char === "'") && (!quote || quote === char)) {
            quote = quote ? undefined : char;
            hasToken = true;
            continue;
        }
        if (!quote && /\s/.test(char)) {
            if (hasToken) {
                parts.push(current);
                current = '';
                hasToken = false;
            }
            continue;
        }
        current += char;
        hasToken = true;
    }
    if (hasToken) {
        parts.push(current);
    }
    if (quote) return [];
    return parts;
}

export function resolveDevServerPath(root: string, urlPath: string): string | undefined {
    if (typeof root !== 'string' || !root) return undefined;
    const sourcePath = typeof urlPath === 'string' ? urlPath.split(/[?#]/, 1)[0] || '/' : '/';
    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(sourcePath === '/' ? '/index.html' : sourcePath);
    } catch {
        return undefined;
    }
    const target = resolve(root, decodedPath.replace(/^[/\\]+/, ''));
    const inside = relative(root, target);
    if (inside && (inside.startsWith('..') || isAbsolute(inside))) return undefined;
    return target;
}

export function withResolvedDevServerPort(cmd: string, args: string[], port: number): string[] {
    const safeCmd = String(cmd ?? '');
    const safeArgs = Array.isArray(args) ? args.map(arg => String(arg)) : [];
    const tokens = [safeCmd, ...safeArgs].map((part) => part.toLowerCase());
    const isVite = tokens.some((part) => /(^|[\\/])vite(\.cmd|\.exe)?$/.test(part) || part === 'vite');
    if (!isVite) return safeArgs;

    const hasPort = safeArgs.some((part) => part === '--port' || part === '-p' || part.startsWith('--port=') || part.startsWith('-p='));
    const hasHost = safeArgs.some((part) => part === '--host' || part === '-H' || part.startsWith('--host=') || part.startsWith('-H='));
    return [
        ...safeArgs,
        ...(hasHost ? [] : ['--host', '127.0.0.1']),
        ...(hasPort ? [] : ['--port', String(port)]),
    ];
}
