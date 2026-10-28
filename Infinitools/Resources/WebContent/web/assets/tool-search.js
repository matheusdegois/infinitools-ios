(() => {
    const words = value => String(value || '').toLocaleLowerCase('pt-BR').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) || [];
    // Bounded Damerau-Levenshtein: insertion, deletion, replacement and adjacent swaps.
    function near(a, b, limit) {
        if (Math.abs(a.length - b.length) > limit) return false;
        let previous = Array.from({length:b.length+1}, (_,i)=>i), beforePrevious;
        for (let i=1; i<=a.length; i++) {
            const row=[i];
            for (let j=1; j<=b.length; j++) {
                row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
                if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])row[j]=Math.min(row[j],beforePrevious[j-2]+1);
            }
            beforePrevious=previous;previous=row;
        }
        return previous[b.length]<=limit;
    }
    function matches(query, document) {
        return query.every(term => document.some(word => word.includes(term) ||
            (term.length>=4 && near(term,word,term.length>=8?2:1))));
    }
    window.ToolSearch = {words, matches};
})();
