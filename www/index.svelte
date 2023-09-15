<script>
    export let message
    let counter = 0
</script>

<svelte:head>
    <title>my title</title>
</svelte:head>

<button on:click={()=>counter++}>{counter}</button>

{#await import('./test.svelte') then test}
    <svelte:component this={test.default} {message}/>
{/await}