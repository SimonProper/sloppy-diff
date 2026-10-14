import { expect, test } from 'vitest';
import { startLsp } from './lsp';

// a server that answers the first request with a log line that isn't a message, then the
// answer split inside a character that takes four bytes
const server = `
process.stdin.once('data', () => {
	const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'café 🎉' }));
	const all = Buffer.concat([
		Buffer.from('X-Log: starting\\r\\n\\r\\n'),
		Buffer.from('Content-Length: ' + body.length + '\\r\\n\\r\\n'),
		body
	]);
	const cut = all.length - 4;
	process.stdout.write(all.subarray(0, cut));
	setTimeout(() => process.stdout.write(all.subarray(cut)), 20);
});
`;

test('a message is read whole, by its bytes, past what is no message', async () => {
	const lsp = startLsp({ command: process.execPath, args: ['-e', server], cwd: '.', root: '.' });
	try {
		expect(await lsp.request('echo', {})).toBe('café 🎉');
	} finally {
		await lsp.close();
	}
});
