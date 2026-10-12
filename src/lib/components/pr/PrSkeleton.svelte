<!-- the next pull request's overview loading, shaped like its header card -->
<div
	class="flex flex-col gap-6"
	role="status"
	aria-label="Loading the pull request"
	aria-busy="true"
>
	<section class="overflow-hidden rounded-xl border border-line bg-surface">
		<div class="p-5">
			<div class="bone h-4 w-2/3 rounded-full"></div>
			<div class="bone mt-3 h-2.5 w-64 rounded-full"></div>
			<div class="mt-6 flex max-w-3xl flex-col gap-2.5">
				{#each [92, 85, 70, 88, 40] as width, i (i)}
					<div class="bone h-2.5 rounded-full" style:width="{width}%"></div>
				{/each}
			</div>
		</div>
		<div class="flex h-10 items-center gap-5 border-t border-line bg-subtle px-5">
			<div class="bone h-2.5 w-24 rounded-full"></div>
			<div class="bone h-2.5 w-20 rounded-full"></div>
		</div>
	</section>
</div>
