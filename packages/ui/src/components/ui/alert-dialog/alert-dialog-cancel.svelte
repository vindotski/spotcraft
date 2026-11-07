<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
	import {
		type ButtonSize,
		type ButtonVariant,
		buttonVariants,
	} from "#ui/components/ui/button/index.js";
	import { cn } from "#ui/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		variant = "outline",
		size = "default",
		...restProps
	}: AlertDialogPrimitive.CancelProps & {
		variant?: ButtonVariant;
		size?: ButtonSize;
	} = $props();
</script>

<AlertDialogPrimitive.Cancel
	bind:ref
	data-slot="alert-dialog-cancel"
	class={cn(buttonVariants({ variant, size }), "", className)}
	{...restProps}
/>
