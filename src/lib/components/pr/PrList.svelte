<script lang="ts">
	import { timeAgo } from '$lib/refs';
	import type { PrSummary } from '$lib/pr/types';

	interface Props {
		/** null when gh couldn't list them */
		prs: PrSummary[] | null;
		/** where picking one goes */
		href: (number: number) => string;
	}

	let { prs, href }: Props = $props();
</script>

<div class="flex flex-col items-center px-4 py-16">
	<div class="w-full max-w-2xl">
		<p class="px-1 pb-2 text-[10.5px] font-medium tracking-wide text-faint uppercase">
			Open pull requests
		</p>
		{#if prs === null}
			<p class="rounded-xl border border-line bg-surface px-4 py-3.5 text-[12.5px] text-muted">
				Couldn't list pull requests. They need
				<a
					class="text-accent hover:underline"
					href="https://cli.github.com"
					target="_blank"
					rel="noopener noreferrer">gh</a
				>, signed in with <code class="font-mono text-fg">gh auth login</code>, and a repository on
				GitHub.
			</p>
		{:else if prs.length === 0}
			<p
				class="rounded-xl border border-line bg-surface px-4 py-6 text-center text-[12.5px] text-muted"
			>
				No open pull requests
			</p>
		{:else}
			<ul class="overflow-hidden rounded-xl border border-line bg-surface p-1">
				{#each prs as pr (pr.number)}
					<li>
						<a
							href={href(pr.number)}
							class="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-subtle"
						>
							<span class="min-w-0 flex-1">
								<span class="flex items-center gap-1.5">
									<span class="truncate text-[12.5px] font-medium">{pr.title}</span>
									<span class="shrink-0 text-[12px] text-faint">#{pr.number}</span>
									{#if pr.isDraft}
										<span
											class="shrink-0 rounded-[4px] border border-line px-1 text-[10px] font-medium text-muted"
											>draft</span
										>
									{/if}
								</span>
								<span class="mt-0.5 block truncate text-[11px] text-faint">
									{pr.author} ·
									<span class="font-mono">{pr.baseRefName} ← {pr.headRefName}</span>
								</span>
							</span>
							<span
								class="mt-0.5 shrink-0 text-[11px] text-faint tabular-nums"
								title="Updated {new Date(pr.updatedAt).toLocaleString()}"
								>{timeAgo(pr.updatedAt)}</span
							>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
