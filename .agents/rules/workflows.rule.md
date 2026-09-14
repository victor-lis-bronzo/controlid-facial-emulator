---
description: Define os workflows obrigatórios de uso de skills para correções de bugs e novas features.
trigger: model_decision
---

# Workflows: Matt Pocock Skills

Sempre que o usuário solicitar a resolução de um "bug" ou a criação de uma "feature" (funcionalidade), você DEVE seguir os fluxos abaixo para orquestrar as skills corretamente.

## 1. Bug Workflow (Fluxo de Correção de Bugs)
1. `diagnosing-bugs`: Iniciar investigando a causa raiz.
2. `to-spec`: (Opcional para bugs pequenos) Redigir especificação de como será corrigido.
3. `to-tickets`: (Opcional) Dividir a spec em tickets menores.
4. `tdd`: Escrever testes que falham reproduzindo o bug e, em seguida, fazer a implementação.
5. `code-review`: Revisar a branch contra a especificação.

## 2. Feature Workflow (Fluxo de Nova Funcionalidade)
1. `prototype`: (Opcional) Criar rascunhos descartáveis para validar UI ou fluxo lógico.
2. `domain-modeling`: (Opcional) Atualizar o `CONTEXT.md` ou criar ADRs para novos termos do domínio.
3. `codebase-design`: Definir limites de arquitetura, contratos e a integração (deep modules).
4. `to-spec`: Oficializar tudo o que foi decidido em uma grande Especificação (Issue).
5. `to-tickets`: Fatiar a Spec em tarefas/tickets acionáveis e isolados.
6. `implement-spec` / `tdd`: Atacar a implementação dos tickets.
7. `code-review`: Revisar o pull request comparando o que foi feito com o que estava na Spec.
