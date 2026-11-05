<script lang="ts">
	import type { DiffLine } from '$lib/diff/types';
	import { tinted } from '$lib/diff/hunks';

	interface Props {
		/** lines of a hunk, by their index in it */
		rows: { line: DiffLine; index: number }[];
		/** marked as what's asked about */
		asked?: (index: number, line: DiffLine) => boolean;
		/** the other side's, faded */
		dimmed?: (line: DiffLine) => boolean;
		/** the row to scroll to, by its index in the hunk */
		first?: number;
	}

	let { rows, asked = () => false, dimmed = () => false, first }: Props = $props();
</script>

<!-- lines drawn as the diff draws them, out of it -->
<div class="twinkleplop font-mono text-[12.5px] leading-5">
	{#each rows as { line, index } (index)}
		{@const on = asked(index, line)}
		<div
			class={[
				'row flex',
				line.kind,
				tinted(line) && 'tinted',
				on && 'asked',
				dimmed(line) && 'dim'
			]}
			data-asked={on && index === first ? '' : undefined}
		>
			<span
				class="gutter relative flex w-24 shrink-0 text-right text-[11px] text-faint tabular-nums select-none"
			>
				<span class="w-12 pr-2">{line.old ?? ''}</span>
				<span class="w-12 pr-2">{line.new ?? ''}</span>
			</span>
			<!-- unhighlighted, lines that are only GitHub's text -->
			<span class="min-w-0 flex-1 pr-4 pl-3 break-all whitespace-pre-wrap"
				>{#if line.html}{@html line.html}{:else}{line.text}{/if}</span
			>
			<span class={['mark w-3.5 shrink-0 self-stretch', on && 'on']}></span>
		</div>
	{/each}
</div>

<style>
	.gutter {
		background: var(--surface);
		border-right: 1px solid var(--line);
	}
	/* drawn like the diff: a tinted gutter with a bar against the code, the code only
	   tinted when no tokens in it are marked */
	.row.add {
		--hue: var(--add);
		--gutter-bg: var(--add-gutter);
		--number: var(--add-number);
		--row-bg: var(--add-bg);
	}
	.row.del {
		--hue: var(--del);
		--gutter-bg: var(--del-gutter);
		--number: var(--del-number);
		--row-bg: var(--del-bg);
	}
	.row:is(.add, .del) .gutter {
		background: var(--gutter-bg);
		color: var(--number);
	}
	.row:is(.add, .del) .gutter::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		right: -1px;
		width: 3px;
		background: var(--hue);
	}
	.row.del .gutter::after {
		background: repeating-linear-gradient(var(--hue) 0 1px, transparent 1px 2px);
	}
	.row.tinted {
		background: var(--row-bg);
	}
	.row.add :global(.novel) {
		background: var(--add-novel);
		border-radius: calc(var(--radius-sm) - 1px);
	}
	.row.del :global(.novel) {
		background: var(--del-novel);
		border-radius: calc(var(--radius-sm) - 1px);
	}
	.row.asked {
		box-shadow: inset 0 0 0 100vmax var(--ink-wash);
	}
	.row.asked .gutter {
		background: color-mix(in oklab, var(--fg) 10%, var(--surface));
		color: var(--fg);
	}
	.row.asked:is(.add, .del) .gutter {
		background: color-mix(in oklab, var(--fg) 8%, var(--gutter-bg));
	}
	.row.dim {
		opacity: 0.38;
	}
	.mark {
		position: relative;
	}
	.mark.on::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		right: 6px;
		width: 2px;
		background: var(--ink-mark);
	}
</style>
