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

**User_Photo**:
A fotografia biométrica facial associada a um User, persistida no armazenamento de arquivos da leitora e servida/manipulada exclusivamente através dos endpoints .fcgi.
_Avoid_: AvatarImage, ProfilePic, UserPicture
