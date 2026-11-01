<script lang="ts" module>
	export type Variant = 'outline' | 'danger' | 'solid' | 'tint' | 'ghost';
	export type Size = 'xs' | 'sm' | 'md' | 'lg';

	export interface Look {
		/** outline stands out of the page, ghost only shows on hover */
		variant?: Variant;
		size?: Size;
		/** drawn by an icon alone, as wide as it's high */
		icon?: boolean;
		/** on: a toggle that's on, or the trigger of an open popover */
		pressed?: boolean;
	}

	// cva style, as SegmentedControl's. Hovers are on a button that isn't disabled, :not
	// rather than :enabled so an <a> gets them too
	const sizes: Record<Size, { text: string; icon: string; round: string }> = {
		xs: { text: 'h-5 px-1.5 text-[11px]', icon: 'size-5', round: 'rounded' },
		sm: { text: 'h-6 px-2 text-[11.5px]', icon: 'size-6', round: 'rounded-md' },
		md: { text: 'h-7 px-2.5 text-[12px]', icon: 'size-7', round: 'rounded-lg' },
		lg: { text: 'h-8 px-3 text-[12px]', icon: 'size-8', round: 'rounded-lg' }
	};

	const variants = (pressed: boolean): Record<Variant, string> => ({
		outline: [
			'border bg-control shadow-raised not-disabled:hover:border-muted not-disabled:hover:text-fg not-disabled:active:shadow-pressed',
			pressed ? 'border-muted text-fg' : 'border-line text-muted'
		].join(' '),
		danger:
			'border border-line bg-control text-muted shadow-raised not-disabled:hover:border-del/50 not-disabled:hover:text-del not-disabled:active:shadow-pressed',
		solid:
			'bg-accent font-medium text-surface shadow-raised not-disabled:hover:opacity-90 not-disabled:active:shadow-pressed',
		tint: 'bg-accent/10 font-medium text-accent not-disabled:hover:bg-accent/15',
		ghost: [
			'not-disabled:hover:bg-subtle not-disabled:hover:text-fg',
			pressed ? 'bg-subtle text-fg' : 'text-muted'
		].join(' ')
	});

	/** A button's look, for an <a> or a <summary> as well as a <Button>. */
	export function buttonClass({
		variant = 'outline',
		size = 'md',
		icon = false,
		pressed = false
	}: Look = {}) {
		const s = sizes[size];
		return [
			'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-40',
			icon ? s.icon : s.text,
			s.round,
			variants(pressed)[variant]
		];
	}
</script>

<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Props = HTMLButtonAttributes &
		Look & {
			ref?: HTMLButtonElement;
		} & ({ icon?: false } | { icon: true; 'aria-label': string });

	let {
		variant,
		size,
		icon,
		pressed,
		ref = $bindable(),
		type = 'button',
		class: className,
		children,
		...rest
	}: Props = $props();
</script>

<button
	bind:this={ref}
	{type}
	class={[buttonClass({ variant, size, icon, pressed }), className]}
	{...rest}>{@render children?.()}</button
>
