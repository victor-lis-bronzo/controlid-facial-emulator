# Control-iD Emulator Domain

The core domain language for the Control-iD Facial Emulator, covering the physical device concepts and the emulated environment.

## Language

**WebGUI**:
A interface gráfica web embarcada no próprio dispositivo, servida localmente pela leitora para administração (atualmente emulada em React).
_Avoid_: Control Panel, Dashboard, Painel Admin

**User**:
A entidade que representa uma pessoa cadastrada no equipamento com permissão de acesso ou administração.
_Avoid_: Person, Account

**WebGuiLayout**:
A moldura estrutural web embarcada (header e sidebar) servida pela leitora para abrigar e organizar a navegação entre as seções administrativas.
_Avoid_: AppShell, MasterLayout, AdminTemplate

**Admin Management Panel**:
A implementação anterior da interface administrativa web, construída sobre uma API REST própria (`/api/admin/*`) com hash router, entregue pela spec `.kiro/specs/admin-management-panel`. Seu frontend (`App.tsx`, `sections/`) foi removido do repositório por ser código órfão, não montado pela aplicação em execução; o backend REST (`/api/admin/*`) permanece registrado mas sem nenhum chamador. Distinta da WebGUI (a reescrita atual, fiel ao dispositivo físico, consumindo exclusivamente `.fcgi`).
_Avoid_: Painel Admin (ver WebGUI/_Avoid_ — essa frase hoje só deve se referir a este conceito, nunca à WebGUI), Old Panel, Legacy Panel, REST Panel

**Debug Console**:
Uma página separada da WebGUI, autenticada pela mesma sessão, que expõe Simulate (disparo de eventos de acesso simulados via `/api/simulate/*`) e Interception Log (tail ao vivo de requisições/webhooks via `/api/interception`) — ferramentas de depuração para integradores sem equivalente na leitora física, por isso deliberadamente fora do invariante de fidelidade da WebGUI.
_Avoid_: Control Panel, Admin Panel, Simulate Page

**User_Photo**:
A fotografia biométrica facial associada a um User, persistida no armazenamento de arquivos da leitora e servida/manipulada exclusivamente através dos endpoints .fcgi.
_Avoid_: AvatarImage, ProfilePic, UserPicture

**API_Image**:
A imagem Docker puramente focada em backend, responsável exclusivamente por emular os endpoints nativos (`.fcgi`), processamento e persistência de dados. Desacoplada da entrega do frontend.
_Avoid_: Backend Container, Mono Image

**Web_Image**:
A imagem Docker contendo o pacote estático final da WebGUI servido via um proxy reverso (Nginx). Atua de forma agnóstica repassando chamadas `.fcgi` dinamicamente para o backend via proxy pass.
_Avoid_: Frontend Container, React Image

**Mono-repo Registry**:
Estratégia de publicação no Docker Hub onde imagens distintas (API e Web) habitam o exato mesmo repositório, sendo separadas e identificadas apenas pelos prefixos de suas tags (ex: `:api-latest` e `:web-latest`).
_Avoid_: Multi-repo, Split registry

**Non-root Container**:
Política de segurança aplicada às imagens Docker onde a aplicação e o container operam estritamente sem privilégios de root (`USER emulator`).
_Avoid_: Root execution, su-exec entrypoints

**Named Volumes Security**:
Comportamento esperado onde os volumes nomeados (`emulator-data`) herdam a propriedade de pastas previamente criadas e chownadas no Dockerfile, garantindo persistência sem violar a política de Non-root.

**Documented Divergence**:
Comportamento de uma rota existente que é deliberadamente simplificado em relação à Access API oficial (ex.: sem matching biométrico real), sempre registrado na seção "Documented divergences" do README.
_Avoid_: Limitation, Known issue

**Route Gap**:
Endpoint ou objeto documentado na Access API oficial que ainda não tem implementação no emulador — é item de backlog, não uma divergência permanente.
_Avoid_: Out of scope, Missing feature
