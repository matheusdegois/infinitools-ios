const search=document.getElementById('catalogSearch');
const count=document.getElementById('catalogCount');
const empty=document.getElementById('catalogEmpty');
const {words,matches}=window.ToolSearch;
const documents=new Map([...document.querySelectorAll('.catalog-item')].map(item=>[item,words(item.textContent+' '+(item.dataset.search||'')+' '+item.closest('.catalog-group').querySelector('h2').textContent)]));
search.addEventListener('input',()=>{
    const terms=words(search.value);
    let visible=0;
    document.querySelectorAll('.catalog-group').forEach(group=>{
        let groupCount=0;
        group.querySelectorAll('.catalog-item').forEach(item=>{
            const match=matches(terms,documents.get(item));
            item.hidden=!match;
            if(match){visible++;groupCount++}
        });
        group.hidden=!groupCount;
    });
    count.textContent=`${visible} ferramenta${visible===1?'':'s'} encontrada${visible===1?'':'s'}`;
    empty.hidden=visible!==0;
});
