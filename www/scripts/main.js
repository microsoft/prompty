(function () {
    const codeBlocks = document.querySelectorAll('.code-box');

    codeBlocks.forEach((codeBlock) => {
        const codeBlockCopyButton = codeBlock.querySelector('.copy-button');

        if(codeBlockCopyButton) {
            codeBlockCopyButton.addEventListener('click', (e) => {
                const parent = e.target.parentElement;
                codeBlock.dispatchEvent(new CustomEvent('copyCode', { bubbles: true }));
            });
            
            codeBlock.addEventListener('copyCode', async (e) => {
                const codeContent = codeBlock.querySelector('.code-content');

                try {
                    await navigator.clipboard.writeText(codeContent.innerText);
                    console.log('Code copied to clipboard');
                    console.log(codeContent.innerText);
                }
                catch (err) {
                    console.error('Failed to copy text to clipboard: ', err);
                }
            });
        }
    });

}());