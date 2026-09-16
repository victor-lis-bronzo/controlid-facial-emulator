# Cobertura completa de rotas da Access API, com hardware sempre mockado

O emulador existe para ser um back-end RESTful mockável: uma aplicação
cliente que normalmente falaria com a leitora física deve poder rodar
contra o emulador sem alterações. Por isso, a meta passa a ser cobrir
**todas** as rotas documentadas na Access API oficial (os ~40 tipos de
objeto em `create_objects`/`load_objects`/`modify_objects`/`destroy_objects`
e os endpoints de ação como `execute_actions.fcgi`, `reboot.fcgi`,
`gpio_state.fcgi`, etc.), mesmo quando a lógica por trás é hardware ou
biometria que o emulador nunca vai reproduzir de verdade — nesses casos a
rota existe e responde de forma plausível, mockada (ver ADR 0001 para o que
conta como divergência documentada vs. bug).

Cada objeto novo recebe schema dedicado (tabela Drizzle + repository +
validação), replicando o padrão já usado para `users`, `groups`, `portals`,
`time_zones` e `access_rules`, em vez de um store genérico de fallback —
mantém a fidelidade estrutural e a consistência de código em troca de mais
esforço por objeto.

**Consequences**: não existe mais uma categoria "fora de escopo
permanente" — todo endpoint da doc oficial é, no limite, um item de
backlog. "Documented divergences" no README continua existindo, mas só
descreve comportamento simplificado de rotas que **existem**, nunca a
ausência de uma rota.
