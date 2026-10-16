# Dev Control

**Versão 0.2.2 · Projeto de Bruno · [GitHub: Brunossaantos](https://github.com/Brunossaantos)**

Um painel universal para acompanhar o Claude Code em qualquer projeto. Reúne consumo, notificações, progresso, perfis, temas e agentes, sem impor um processo de trabalho.

## Começar

Requer **Claude Code 2.1.296 ou superior**, com suporte a mods/function hooks habilitado na conta. Essa API é de acesso antecipado e pode mudar entre versões.

Para instalar diretamente deste repositório, execute:

```powershell
claude --version
claude plugin marketplace add Brunossaantos/dev-control
claude plugin install dev-control@dev-control-mods --scope user
```

Inicie uma sessão nova ou execute `/reload-plugins`. Abra pelo botão **◆ Dev Control** ou pelo comando `/dev-control`.

Para experimentar sem instalar:

```powershell
claude --plugin-dir ./plugins/dev-control
```

O uso do plugin não exige Node.js, npm ou Python separados. O som vem incluído no pacote.

## Painel

| Seção | O que oferece |
|---|---|
| Monitor de consumo | Contexto, tokens, limites de 5h/7d, horários de renovação e atualização manual. |
| Notificações | Canais independentes para terminal, som e sistema operacional. |
| Zen / foco | Plano por etapas com conclusão, espera, interrupção e erro. |
| Temas | Seis paletas próprias e uma paleta personalizável. |
| Modelo e permissões | Modelo, esforço e controles de permissão nativos. |
| Perfis de projeto | Preferências por projeto ou globais. |
| Monitor de agentes | Agentes reais, tarefas, estado, modelo, esforço e resultado observado. |

A linha de status mostra contexto e limites, com modelo, pasta e ramificação Git quando há espaço. O plugin preserva o comando de status que o usuário já tenha configurado.

## Notificações

Abra `/dev-control notificacoes`.

Terminal, alertas de contexto/conta, erros e solicitação de entrada estão ligados por padrão. Som, aviso externo e aviso de resposta concluída estão desligados até você selecionar.

As faixas padrão são **70%, 85% e 95%**. Você pode configurar até seis porcentagens inteiras de 1 a 100. Ao saltar várias faixas, é enviado um único aviso com a faixa mais alta para cada métrica. O aviso não se repete dentro da mesma faixa; nova janela ou queda significativa de contexto rearma os alertas. Alterar as faixas também cria uma nova configuração de alertas.

O intervalo mínimo padrão é 30 segundos, configurável entre 15 e 300 segundos. Um temporizador de 15 segundos verifica quando é hora de consultar. O intervalo entre avisos de outros eventos é separado por tipo, de 5 a 600 segundos, com padrão de 60.

Use **Testar os canais de notificação selecionados** para verificar cada canal. O painel informa falhas sem cancelar os outros canais.

| Ambiente | Aviso externo |
|---|---|
| Windows | Balão na bandeja via Windows PowerShell. |
| macOS | Notificação via osascript. |
| Linux | notify-send em uma sessão gráfica, se estiver disponível. |
| WSL | Tenta usar Windows PowerShell pela interoperabilidade. |

O sistema operacional pode bloquear ou silenciar um aviso. O resultado “comando de notificação aceito” significa que o comando foi aceito, sem garantir que a notificação foi exibida. O plugin não instala ferramentas externas automaticamente.

## Consumo e continuidade

**Contexto** é o tamanho da conversa; **5h/7d** são limites da conta. Os dados da conta são os reportados na última resposta API disponível ao motor, não uma consulta externa de saldo. Leituras ausentes aparecem como indisponíveis. Falhas de consulta marcam os dados anteriores como possivelmente desatualizados.

A consulta simples desses dados não inicia chamadas ao modelo. Não há estimativa exata de mensagens restantes nem promessa de economia de tokens. A idade de cache é uma estimativa a partir da última resposta observada, não comprova reutilização do cache.

**Preparar solicitação de continuidade** acrescenta uma solicitação de resumo ao rascunho existente. Você decide enviar pressionando Enter. Não executa o modelo, não compacta a conversa nem altera arquivos automaticamente.

## Progresso e agentes

Ative Zen / foco para orientar o modelo a informar um plano. Somente etapas concluídas contam no percentual. Sem etapas, aparece `n/d`. O fim de uma resposta não conclui automaticamente um plano pendente. Erros e interrupções continuam visíveis; **Mostrar todos os detalhes das ferramentas** expande os detalhes normais.

O plano também acompanha TodoWrite, TaskCreate e TaskUpdate do agente principal, após chamadas bem-sucedidas. Chamadas de subagentes não substituem o plano principal. O progresso informado pelo modelo precisa corresponder a verificações reais; não substitui os testes do projeto.

O monitor de agentes observa os registros do motor. Nunca inicia ou envia mensagens a agentes. Modelo, esforço e resultado só aparecem quando os respectivos eventos foram observados. Resultados são trechos de até 1.000 caracteres; são exibidos os últimos 12 registros que correspondem ao filtro. **Abrir /tasks nativo** abre o gerenciamento do Claude Code.

Por padrão, o esforço escolhido afeta apenas o agente principal. **Aplicar esforço também aos subagentes** permite estender a seleção aos subagentes de forma explícita.

## Preferências

Em Perfis de projeto, salve para o projeto ou como padrão global. No início de uma sessão, o perfil do projeto prevalece sobre o global. Modelo, esforço, canais, eventos, faixas, Zen e paleta são salvos no armazenamento privado do plugin, sem criar arquivos no repositório do projeto. Remover um perfil salvo mantém a sessão atual.

Preferências da versão 0.1 não são importadas; configure e salve novamente no painel.

As permissões continuam sob controle do Claude Code. Shift+Tab muda a sessão atual. O seletor de padrão grava o modo para sessões futuras, preservando confirmações exigidas pelo motor. Perfis não guardam permissões.

## Temas próprios

As paletas são **Oceano, Floresta, Violeta, Brasa, Papel e Grafite**. A paleta personalizada permite escolher destaque, fundo e texto com cores hexadecimais. Nenhum catálogo de temas é baixado.

Os temas usam o formato nativo do Claude Code. Ao carregar um tema customizado pela primeira vez, reinicie uma vez; alterações seguintes podem ser recarregadas ao vivo. As preferências de tema do Claude ficam em `~/.claude/settings.json`, com cópia de segurança `.dev-control.bak`. **Restaurar tema anterior** restaura a escolha anterior.

No Windows Terminal, o perfil identificado por WT_PROFILE_ID também recebe a paleta. Abas do mesmo perfil compartilham essas cores. Ao terminar a sessão, a paleta temporária do perfil é removida e a escolha anterior é restaurada, preservando outras configurações. O arquivo do Terminal também recebe uma cópia de segurança. Se o perfil já estiver sob controle de outra sessão do Dev Control, a alteração externa é evitada. O tema nativo do Claude é uma preferência global e pode ser compartilhado entre sessões.

## Atualizar uma instalação anterior

Para migrar uma instalação antiga ou uma origem local para este repositório, execute:

```powershell
claude plugin uninstall dev-control@dev-control-mods --scope user
claude plugin marketplace remove dev-control-mods
claude plugin marketplace add Brunossaantos/dev-control
claude plugin install dev-control@dev-control-mods --scope user
```

Reinicie a sessão após a instalação.

Nas próximas atualizações:

```powershell
claude plugin marketplace update dev-control-mods
claude plugin update dev-control@dev-control-mods
```

Inicie uma nova sessão ou use `/reload-plugins`.

## Comandos

```text
/dev-control
/dev-control consumo
/dev-control notificacoes
/dev-control zen
/dev-control temas
/dev-control modelo
/dev-control perfis
/dev-control agentes
/dev-control continuidade
```

## Desenvolvimento

A implementação usa a API oficial do Claude Code. O código de comportamento está em `hooks/main.tsx`; regras puras estão em `hooks/domain.ts`; o contrato público fica em `types/index.d.ts`.

```powershell
claude plugin validate ./plugins/dev-control --strict
claude plugin test ./plugins/dev-control
claude plugin validate . --strict
```

Para usar TypeScript, gere as declarações da API com `/plugin-types` no Claude Code e ajuste o include do tsconfig ao caminho gerado pela sua versão.

Consulte [AUTORIA.md](AUTORIA.md), [CHANGELOG.md](CHANGELOG.md) e [VERIFICACAO.md](VERIFICACAO.md).

Os atalhos antigos em inglês continuam aceitos por compatibilidade. Os comandos do Claude Code, nomes de modelos e identificadores da API mantêm seus nomes nativos. Textos de tarefas e resultados fornecidos por outros agentes são exibidos como recebidos.
