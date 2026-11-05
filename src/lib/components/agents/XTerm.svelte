<script lang="ts">
	import '@xterm/xterm/css/xterm.css';
	import { sizeTerminal, typeInTerminal } from '$lib/agents/terminals.remote';
	import type { TerminalEvent } from '$lib/agents/types';

	let { id, onexit }: { id: string; onexit?: (code: number) => void } = $props();

	let el: HTMLDivElement;

	/** a theme colour as xterm reads them, whatever the CSS writes it in */
	function rgb(name: string, alpha = 1) {
		const ctx = document.createElement('canvas').getContext('2d')!;
		ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	const theme = () => ({
		background: rgb('--sidebar'),
		foreground: rgb('--fg'),
		cursor: rgb('--fg'),
		selectionBackground: rgb('--accent', 0.3)
	});

	$effect(() => {
		let cleanup = () => {};
		let gone = false;
		Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
			([{ Terminal }, { FitAddon }]) => {
				if (gone) return;
				const term = new Terminal({
					fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono-stack'),
					fontSize: 12,
					cursorBlink: true,
					scrollback: 10_000,
					theme: theme(),
					// the ANSI colours are a dark terminal's, readable on a light theme too
					minimumContrastRatio: 4.5
				});
				const fit = new FitAddon();
				term.loadAddon(fit);
				term.open(el);
				fit.fit();
				term.focus();

				// keys go one request after another, so they arrive in the order typed
				let typed = '';
				let sending = false;
				async function flush() {
					if (sending || !typed) return;
					sending = true;
					const data = typed;
					typed = '';
					await typeInTerminal({ id, data }).catch(() => {});
					sending = false;
					flush();
				}
				term.onData((data) => ((typed += data), flush()));
				const size = () => sizeTerminal({ id, cols: term.cols, rows: term.rows }).catch(() => {});
				term.onResize(size);
				size();

				const output = new EventSource(`/agents/terminal?id=${encodeURIComponent(id)}`);
				// sent from the start again on a reconnect
				output.onopen = () => term.reset();
				output.onmessage = (message) => {
					const event: TerminalEvent = JSON.parse(message.data);
					if ('data' in event) term.write(event.data);
					else (output.close(), onexit?.(event.exit));
				};

				const resized = new ResizeObserver(() => el.offsetWidth && fit.fit());
				resized.observe(el);
				// the theme is classes on the root
				const themed = new MutationObserver(() => (term.options.theme = theme()));
				themed.observe(document.documentElement, { attributeFilter: ['class'] });
				cleanup = () => {
					output.close();
					resized.disconnect();
					themed.disconnect();
					term.dispose();
				};
			}
		);
		return () => ((gone = true), cleanup());
	});
</script>

<div bind:this={el} class="h-full min-h-0 w-full"></div>
