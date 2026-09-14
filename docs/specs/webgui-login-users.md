# Especificação: WebGUI - Autenticação e Gestão de Usuários

## 1. Visão Geral
O objetivo desta feature é construir a fundação da interface gráfica (WebGUI) embarcada do **Control-iD Facial Emulator**. O WebGUI deve ser uma cópia fiel da interface original da leitora, abandonando quaisquer "atalhos" de API para o frontend. A aplicação React será um cliente rigoroso da própria API `.fcgi` emulada.

## 2. Escopo Inicial
Esta especificação foca na primeira fatia de entrega:
1. **Infraestrutura Visual:** Configuração de estilos e roteamento.
2. **Barreira de Login:** Proteção de acesso exigindo autenticação do dispositivo.
3. **Gestão de Usuários (Básico):** Listagem e criação de usuários com os campos básicos (Nome, Matrícula, Senha).

## 3. Decisões Arquiteturais e Stack

### 3.1. Frontend Stack
- **Framework:** React + Vite (Workspace `web`).
- **Navegação:** `react-router-dom` para gerenciamento de páginas (ex: `/admin/login`, `/admin/users`).
- **Estilização:** `Tailwind CSS`. Selecionado para permitir clonagem visual *pixel-perfect* de forma ágil, sem poluição de arquivos CSS.

### 3.2. Regra de Ouro: Consumo de API
A aplicação React **não** deve utilizar rotas auxiliares dedicadas ao painel (ex: `/api/...`) para operações do domínio original. 
O WebGUI consumirá **exclusivamente** os endpoints oficiais `.fcgi` expostos pelo emulador. Se a ação não pode ser feita via `.fcgi`, o `.fcgi` do emulador precisa ser corrigido para suportá-la.

### 3.3. Autenticação e Sessão
- **Endpoint:** O frontend submeterá credenciais para `POST /login.fcgi`.
- **Persistência:** O token de sessão retornado pela API será armazenado no `localStorage` do navegador para sobreviver a recarregamentos (F5).
- **Gerenciamento de Estado:** A sessão será injetada globalmente na aplicação via **React Context API**.
- **Injeção de Token:** Um client HTTP (ou hook customizado) interceptará as requisições para os endpoints `.fcgi` e injetará automaticamente o parâmetro `?session=TOKEN` em todas as chamadas autenticadas.

## 4. Fluxos de Interface (User Flows)

### 4.1. Fluxo de Login
1. Usuário acessa `/admin`.
2. O Router verifica se há um token válido no Context/localStorage.
3. Se não houver, redireciona para `/admin/login`.
4. Usuário insere "Login" e "Senha".
5. App realiza request para `/login.fcgi`.
6. Em caso de sucesso, salva o token e redireciona para `/admin/users` (ou Dashboard, futuramente).

### 4.2. Fluxo de Gestão de Usuários (Básico)
1. **Listagem:** O componente de usuários carrega a lista chamando `POST /load_objects.fcgi?object=users`.
2. **Exibição:** Renderiza tabela/lista com Nome e Matrícula (`registration`).
3. **Criação:** Formulário exibe campos "Nome", "Matrícula" e "Senha/PIN".
4. **Submissão:** Dispara `POST /create_objects.fcgi?object=users` com o payload correto estipulado pela API da Control-iD.

## 5. Critérios de Aceite
- [ ] Tailwind CSS está configurado e funcionando no workspace `web`.
- [ ] React Router está protegendo as rotas internas.
- [ ] Login via `.fcgi` emite um token persistente.
- [ ] O componente de listagem de usuários consome `load_objects.fcgi`.
- [ ] Recarregar a página interna (F5) não derruba a sessão do usuário.
