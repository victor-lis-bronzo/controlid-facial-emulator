# Access API oficial como fonte única de verdade para fidelidade

O emulador precisa decidir, para cada endpoint/payload `.fcgi`, o que conta
como "correto". Decidimos que a [documentação oficial da Access API do
Control-iD](https://www.controlid.com.br/docs/access-api-pt/) (complementada
pelos exemplos oficiais em `controlid/integracao`) é a única fonte de
verdade para paths, métodos, nomes de campo e formas de payload — não a
intuição do desenvolvedor nem comportamento inferido por engenharia reversa
de hardware físico. Toda divergência deliberada em relação a essa fonte deve
ser documentada explicitamente na seção "Documented divergences" do
`README.md`; divergência não documentada é tratada como bug, não como
design.

**Consequences**: um endpoint ou campo sem correspondência rastreável na doc
oficial (ou nos exemplos de integração) não deve ser adicionado à superfície
`.fcgi` sem antes virar uma entrada em "Documented divergences" — esse é o
crivo de review para qualquer PR que toque `api/src/routes/fcgi/`.
