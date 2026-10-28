(() => {
    const search = document.getElementById('toolSearch');
    const tabs = [...document.querySelectorAll('.tab')];
    const groups = [...document.querySelectorAll('.tool-group')];
    const cards = [...document.querySelectorAll('.tool-card')];
    const empty = document.getElementById('emptySearch');
    let category = 'all';
    const {words,matches}=window.ToolSearch;
    const documents=new Map(cards.map(card=>[card,words(card.dataset.search)]));

    function filterTools() {
        const terms = words(search?.value);
        let visibleCount = 0;
        groups.forEach(group => {
            const categoryMatch = category === 'all' || group.dataset.family === category;
            let groupCount = 0;
            group.querySelectorAll('.tool-card').forEach(card => {
                const match = categoryMatch && matches(terms,documents.get(card));
                card.hidden = !match;
                if (match) { groupCount++; visibleCount++; }
            });
            group.querySelectorAll('.image-home-subgroup').forEach(subgroup => {
                subgroup.hidden = ![...subgroup.querySelectorAll('.tool-card')].some(card => !card.hidden);
            });
            group.hidden = groupCount === 0;
        });
        if (empty) empty.hidden = visibleCount !== 0;
    }

    search?.addEventListener('input', filterTools);
    tabs.forEach(tab => tab.addEventListener('click', () => {
        category = tab.dataset.category;
        tabs.forEach(item => { item.classList.toggle('active', item === tab); item.setAttribute('aria-pressed', String(item === tab)); });
        filterTools();
    }));
    cards.forEach(card => card.addEventListener('pointermove', event => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    }));
})();
