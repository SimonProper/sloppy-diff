<script lang="ts" module>
	type Size = 'sm' | 'md' | 'lg';
	/** `icon` is for options drawn by an icon alone */
	type Text = 'sm' | 'md' | 'icon';

	// one set of variants per element, cva style

	const rootVariants = ({ size, ghost }: { size: Size; ghost: boolean }) => [
		'relative flex shrink-0',
		// navigation has no box, a setting does
		!ghost && 'border border-line bg-surface',
		{ sm: 'rounded-md p-px', md: 'rounded-lg p-0.5', lg: 'rounded-lg p-0.5' }[size]
	];

	const itemVariants = ({ size, text, active }: { size: Size; text: Text; active: boolean }) => [
		'relative flex items-center justify-center gap-1.5 transition-colors duration-200',
		{ sm: 'h-5 rounded-[5px]', md: 'h-6 rounded-md', lg: 'h-7 rounded-md' }[size],
		{ sm: 'px-2 text-[11.5px]', md: 'px-2.5 text-[12px]', icon: 'px-1.5' }[text],
		active ? 'text-fg' : 'text-muted hover:text-fg'
	];

	/** the active option's background, sliding between them */
	const pillVariants = ({ size }: { size: Size }) => [
		'absolute left-0 bg-subtle transition-[translate,width] duration-200 ease-out motion-reduce:transition-none',
		{ sm: 'inset-y-px rounded-[5px]', md: 'inset-y-0.5 rounded-md', lg: 'inset-y-0.5 rounded-md' }[
			size
		]
	];
</script>

<script lang="ts" generics="T extends string">
	import type { Snippet } from 'svelte';

	interface Option {
		value: T;
		label: string;
		title?: string;
	}

	interface Props {
		options: Option[];
		value: T;
		onchange: (value: T) => void;
		/** height */
		size?: Size;
		/** label size, and the room around it */
		text?: Exclude<Text, 'icon'>;
		/** names the group for screen readers */
		label?: string;
		/** no box around it, for tabs rather than a setting */
		ghost?: boolean;
		/** only what `before` draws, the label becomes the tooltip */
		iconOnly?: boolean;
		/** clicking leaves the focus where it was, in a text field */
		keepFocus?: boolean;
		before?: Snippet<[Option]>;
		after?: Snippet<[Option]>;
	}

	let {
		options,
		value,
		onchange,
		size = 'md',
		text = 'md',
		label,
		ghost = false,
		iconOnly = false,
		keepFocus = false,
		before,
		after
	}: Props = $props();

	let buttons = $state<HTMLButtonElement[]>([]);
	/** where the active option's background sits, measured once the buttons are laid out */
	let pill = $state<{ x: number; width: number }>();

	// it slides from the option picked before. What's in the buttons can change their widths
	$effect(() => {
		const active = buttons[options.findIndex((o) => o.value === value)];
		if (!active) return;
		const observer = new ResizeObserver(() => {
			pill = { x: active.offsetLeft, width: active.offsetWidth };
		});
		for (const button of buttons) if (button) observer.observe(button);
		return () => observer.disconnect();
	});
</script>

<div class={rootVariants({ size, ghost })} role="group" aria-label={label}>
	<!-- appears where it is, only moving between options slides -->
	{#if pill}
		<span class={pillVariants({ size })} style:translate="{pill.x}px" style:width="{pill.width}px"
		></span>
	{/if}
	{#each options as option, i (option.value)}
		{@const active = option.value === value}
		<button
			bind:this={buttons[i]}
			type="button"
			title={option.title ?? (iconOnly ? option.label : undefined)}
			aria-label={iconOnly ? option.label : undefined}
			aria-pressed={active}
			class={[
				itemVariants({ size, text: iconOnly ? 'icon' : text, active }),
				// before it's measured the active one has its own background
				!pill && active && 'bg-subtle'
			]}
			onpointerdown={keepFocus ? (e) => e.preventDefault() : undefined}
			onclick={() => onchange(option.value)}
		>
			{@render before?.(option)}
			{#if !iconOnly}
				<!-- as wide as the medium label underneath, so picking one doesn't shift the rest -->
				<span class="grid text-center">
					<span class="invisible col-start-1 row-start-1 font-medium" aria-hidden="true"
						>{option.label}</span
					>
					<span class={['col-start-1 row-start-1', active && 'font-medium']}>{option.label}</span>
				</span>
			{/if}
			{@render after?.(option)}
		</button>
	{/each}
</div>
