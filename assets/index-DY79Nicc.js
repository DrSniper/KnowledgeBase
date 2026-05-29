var e=Object.defineProperty,t=(t,n)=>{let r={};for(var i in t)e(r,i,{get:t[i],enumerable:!0});return n||e(r,Symbol.toStringTag,{value:`Module`}),r};(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var n=`---
title: ACP Deployment 部署风险与排查清单
type: troubleshooting
category: devops
tags:
  - kubernetes
  - alauda
  - acp
  - troubleshooting
  - deployment
  - checklist
  - production
created: 2026-05-29
updated: 2026-05-29
status: active
source: project
severity: medium
environment: generic
---

# ACP Deployment 部署风险与排查清单

## 1. 问题背景

当前项目 \`deployment/\` 目录包含大量平台部署 YAML、Helm 模板、ModuleInfo、ResourcePatch、Secret 示例、网络配置和外部集成配置。该目录适合作为交付资料库，但不适合整体直接执行。

本文档用于沉淀部署过程中的主要风险、排查命令、验证步骤和回滚思路。

## 2. 快速结论

ACP 平台部署的核心风险集中在：

1. 整目录 apply。
2. 占位符、示例环境名、示例 IP 未替换。
3. Secret / TLS / token / S3 凭据泄露或配置错误。
4. MachineConfig 触发节点滚动。
5. Ingress / MetalLB / Egress 网络配置影响业务流量。
6. ResourcePatch 目标资源不存在或 patch 字段不兼容。
7. Helm 模板被误当成普通 YAML apply。
8. RBAC 权限过宽。

## 3. 部署前必查

### 3.1 检查占位符

\`\`\`bash
grep -R "<.*>" deployment/ --include='*.yaml' --include='*.yml' --include='*.md'
\`\`\`

重点处理：

\`\`\`text
<cluster-name>
<base64>
<egress node ip>
<auth-secret-name>
<load-balancer-ip-or-domain-name>
<s3-url>
<bucket-name>
\`\`\`

### 3.2 检查示例环境名

\`\`\`bash
grep -R -E "acpsit|acpuat|acp2|uat\\.alauda|sit" deployment/ \\
  --include='*.yaml' --include='*.yml' --include='*.md'
\`\`\`

如果目标不是这些环境，必须替换。

### 3.3 检查敏感信息

\`\`\`bash
grep -R -i -E "password|passwd|token|secret|authkey|access_key|secret_access_key|tls.key" deployment/ \\
  --include='*.yaml' --include='*.yml' --include='*.md'
\`\`\`

处理原则：

- 不把真实凭据提交到 Git。
- 使用 Kubernetes Secret、ExternalSecret 或现场密钥管理方案。
- 知识库和 GitHub Pages 只保留脱敏示例。

### 3.4 检查不可直接 apply 的模板

\`\`\`bash
grep -R "{{ .* }}" deployment/ --include='*.yaml' --include='*.yml'
\`\`\`

如果出现 Helm 模板语法，不能直接执行：

\`\`\`bash
kubectl apply -f <helm-template-file>
\`\`\`

应使用：

\`\`\`bash
helm template <release> <chart-path> -f <values.yaml>
helm upgrade --install <release> <chart-path> -n <namespace> -f <values.yaml>
\`\`\`

## 4. 常见问题与排查

### 4.1 Cluster / MachineDeployment 未创建成功

检查：

\`\`\`bash
kubectl get cluster -A
kubectl get dcscluster -A
kubectl get kubeadmcontrolplane -A
kubectl get machinedeployment -A
kubectl describe machinedeployment <name> -n cpaas-system
kubectl get events -A --sort-by=.lastTimestamp | tail -100
\`\`\`

常见原因：

- DCS 认证 Secret 错误。
- IP/hostname/machineName 不匹配。
- 虚拟化资源池、模板、网络配置错误。
- Cluster API ownerReference 或 namespace 不一致。

### 4.2 节点没有正确 label

检查：

\`\`\`bash
kubectl get nodes --show-labels
kubectl get nodes -l ingress=true
kubectl get nodes -l egress=
kubectl get nodes -l log=
kubectl get nodes -l monitor=
kubectl get nodes -l registry=
\`\`\`

补充 label 示例：

\`\`\`bash
kubectl label node <node-name> ingress=true
kubectl label node <node-name> egress=
kubectl label node <node-name> log=
kubectl label node <node-name> monitor=
kubectl label node <node-name> registry=
\`\`\`

注意：生产操作前必须确认节点用途和调度影响。

### 4.3 Pod 因 taint 无法调度

检查：

\`\`\`bash
kubectl describe pod <pod-name> -n <namespace>
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
\`\`\`

常见事件：

\`\`\`text
node(s) had untolerated taint
\`\`\`

处理：

- 给目标 workload 添加 toleration。
- 或调整节点 taint，但生产环境不建议随意移除 infra taint。

### 4.4 MetalLB 没有分配 LoadBalancer IP

检查：

\`\`\`bash
kubectl get ipaddresspool -n metallb-system
kubectl get l2advertisement -n metallb-system
kubectl get svc -A | grep LoadBalancer
kubectl describe svc <svc-name> -n <namespace>
kubectl get pods -n metallb-system
\`\`\`

常见原因：

- IP 池范围错误或冲突。
- L2Advertisement 未关联 IPAddressPool。
- MetalLB controller/speaker 异常。
- Service annotation 或 address pool 不匹配。

### 4.5 Ingress 不可访问

检查：

\`\`\`bash
kubectl get ingressnginx -n ingress-nginx-operator
kubectl get svc -n ingress-nginx-operator
kubectl get pods -n ingress-nginx-operator -o wide
kubectl logs -n ingress-nginx-operator <ingress-controller-pod> --tail=200
kubectl get ingress -A
\`\`\`

重点确认：

- LoadBalancer IP 是否分配。
- controller 是否调度到 ingress 节点。
- default TLS secret 是否存在。
- \`proxy-body-size\` 是否满足镜像上传等场景。
- DNS 是否解析到正确 IP。

### 4.6 Egress 出网失败

检查：

\`\`\`bash
kubectl get network-attachment-definitions -A
kubectl get subnet
kubectl get vpc ovn-cluster -o yaml
kubectl get vpcegressgateway -A
kubectl get pods -A -o wide | grep -i egress
\`\`\`

测试出网：

\`\`\`bash
kubectl run egress-test -n <namespace> --rm -it --image=curlimages/curl -- sh
curl -v https://example.com
\`\`\`

常见原因：

- egress 节点 label 缺失。
- 外部网卡名不匹配，例如 \`eth1\`。
- subnet gateway / excludeIps / externalIPs 错误。
- VPC BFD 配置缺失。
- NetworkPolicy 阻断。

### 4.7 Registry push/pull 失败

检查：

\`\`\`bash
kubectl get deploy -n cpaas-system image-registry registry-gateway-gateway -o wide
kubectl get ingress -n cpaas-system
kubectl get secret -n cpaas-system registry-ssl registry-s3-secret
kubectl logs -n cpaas-system deploy/image-registry --tail=200
kubectl logs -n cpaas-system deploy/registry-gateway-gateway --tail=200
\`\`\`

常见原因：

- TLS 证书不匹配。
- S3 endpoint、bucket 或凭据错误。
- ingress \`proxy-body-size\` 不足。
- registry/gateway 未调度到 registry 节点。
- DNS 或外部访问路径错误。

### 4.8 VictoriaMetrics / kubectl top 异常

检查：

\`\`\`bash
kubectl get minfo -A | grep -i victoriametrics
kubectl get pods -n cpaas-system | grep -Ei 'victoria|vmagent|vmalert|adapter'
kubectl get pvc -n cpaas-system
kubectl top node
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | head
\`\`\`

常见原因：

- prometheus-adapter 查询语句错误。
- vmcluster label 不匹配。
- VM 组件未 Ready。
- StorageClass/PVC 异常。

### 4.9 ClickHouse / 日志链路异常

检查：

\`\`\`bash
kubectl get secret -n cpaas-system | grep -Ei 'clickhouse|syslog'
kubectl get pods -n cpaas-system -o wide | grep -Ei 'clickhouse|razor|log|vector'
kubectl get rpch -A
kubectl get minfo -A | grep -Ei 'log|clickhouse'
kubectl logs -n cpaas-system <log-component-pod> --tail=200
\`\`\`

常见原因：

- ClickHouse S3 Secret 错误。
- syslog CA 未挂载。
- ResourcePatch 未生效。
- log 节点 label 缺失。
- vector 配置错误。

### 4.10 ResourcePatch 没有生效

检查：

\`\`\`bash
kubectl get rpch -A
kubectl describe rpch <name> -n <namespace>
kubectl get <target-kind> <target-name> -n <namespace> -o yaml
\`\`\`

常见原因：

- target label/hash 不匹配。
- 目标资源不存在。
- patch path 与当前版本资源结构不匹配。
- patch 与 operator reconciliation 冲突。

### 4.11 Etcd Backup 没有上传 S3

检查：

\`\`\`bash
kubectl get etcdbackupconfiguration
kubectl describe etcdbackupconfiguration etcd-backup-default
kubectl get secret -n cpaas-system etcd-backup-s3-secret
kubectl get pods -n cpaas-system | grep -i etcd
\`\`\`

验证 S3：

\`\`\`bash
aws s3 --endpoint https://<s3-url> ls s3://<bucket-name>/<dir> --profile <profile> --no-verify-ssl
\`\`\`

常见原因：

- S3 endpoint 不可达。
- access key / secret key 错误。
- bucket 或 region 错误。
- 控制平面节点无法访问 S3。

## 5. 回滚思路

### 5.1 低风险资源

Namespace、ConfigMap、Dashboard、Scan 等资源通常可按文件删除或重新 apply：

\`\`\`bash
kubectl delete -f <file>
kubectl apply -f <previous-file>
\`\`\`

### 5.2 高风险资源

以下资源不要盲目删除：

- Cluster / DCSCluster
- KubeadmControlPlane
- MachineDeployment
- MachineConfig
- Registry
- IngressNginx
- EgressGateway
- EtcdBackupConfiguration

建议先：

\`\`\`bash
kubectl get <kind> <name> -n <namespace> -o yaml > backup.yaml
kubectl describe <kind> <name> -n <namespace>
\`\`\`

再根据影响面回滚。

### 5.3 Helm 组件

\`\`\`bash
helm history <release> -n <namespace>
helm rollback <release> <revision> -n <namespace>
\`\`\`

### 5.4 Deployment 组件

\`\`\`bash
kubectl rollout history deploy/<name> -n <namespace>
kubectl rollout undo deploy/<name> -n <namespace>
\`\`\`

## 6. 最终验收命令

\`\`\`bash
kubectl get nodes -o wide
kubectl get nodes --show-labels
kubectl get pods -A | grep -Ev 'Running|Completed'
kubectl get ingress -A
kubectl get svc -A | grep LoadBalancer
kubectl get pvc -A
kubectl get minfo -A
kubectl get rpch -A
kubectl get scan -A
kubectl get scansuite -A
kubectl get cronjob -A
\`\`\`

业务/平台验收：

- [ ] ingress 域名可访问。
- [ ] registry 可 push/pull。
- [ ] egress namespace 可出网。
- [ ] VictoriaMetrics 可查询指标。
- [ ] custom.metrics API 可用。
- [ ] ClickHouse / logagent / vector 正常。
- [ ] 外部 syslog 可收到日志。
- [ ] etcd backup 文件已上传 S3。
- [ ] Zabbix proxy/agent 在线。
- [ ] Compliance scan 有结果。
- [ ] SentinelOne agent 在线。
- [ ] Heartbeat global/workload 均可访问。

## 7. 相关文档

- [[ACP Deployment 部署顺序与模块总览]]
- [[ACP 平台部署组件依赖关系]]
`,r=`---
title: ACP Deployment 部署顺序与模块总览
type: runbook
category: devops
tags:
  - kubernetes
  - alauda
  - acp
  - deployment
  - runbook
  - platform-engineering
  - github-pages
created: 2026-05-29
updated: 2026-05-29
status: active
source: project
environment: generic
---

# ACP Deployment 部署顺序与模块总览

## 1. 背景

本文档基于当前项目 \`deployment/\` 目录下的部署资料整理而成，用于沉淀 ACP / Alauda 平台交付时的部署顺序、模块职责、依赖关系、风险点和验证方式。

本次整理范围包括：

- 集群创建
- 节点系统配置
- MetalLB
- IngressNginx
- Egress / Multus / Kube-OVN
- Registry / Registry Gateway
- VictoriaMetrics 监控
- 自定义指标和 Dashboard
- ClickHouse 日志链路
- 日志与指标外部转发
- RunOCP 自动化账号和命名空间策略
- Zabbix 对接
- Compliance Operator
- SentinelOne
- Etcd Backup
- LocalDNS
- Heartbeat 验证
- Registry image prune

## 2. 重要原则

### 2.1 禁止整体 apply deployment 目录

不要直接执行：

\`\`\`bash
kubectl apply -f deployment/
\`\`\`

原因：

- 目录中既有 Kubernetes YAML，也有 Helm 模板、说明文件、ModuleInfo、ResourcePatch 和示例配置。
- 多个文件包含占位符，例如 \`<cluster-name>\`、\`<base64>\`、\`<egress node ip>\`。
- 部分配置写死了示例环境名、IP、域名或集群名，发布前必须替换。
- ResourcePatch 依赖目标资源已存在，不能提前应用。
- 某些文件是合并版和拆分版，重复 apply 可能造成覆盖或冲突。
- Secret / TLS / S3 / token 等敏感配置必须在目标环境中重新生成或确认。

### 2.2 推荐执行方式

每个文件执行前先 dry-run：

\`\`\`bash
kubectl apply --dry-run=server -f <file>
\`\`\`

确认无误后再 apply：

\`\`\`bash
kubectl apply -f <file>
\`\`\`

对于 Alauda 平台 CRD，例如 \`ModuleInfo\`、\`ResourcePatch\`，可按现场规范使用：

\`\`\`bash
ac apply -f <file>
\`\`\`

### 2.3 推荐整理有序交付目录

建议不要直接修改原始 \`deployment/\`，而是生成有序目录：

\`\`\`bash
mkdir -p deployment/ordered
\`\`\`

命名格式：

\`\`\`text
<阶段号>-<顺序号>-<模块>-<动作或资源>.yaml
\`\`\`

示例：

\`\`\`text
01-01-cluster-dcs-auth-secret.yaml
01-02-cluster-cluster.yaml
02-01-machineconfig-master-chrony.yaml
03-01-metallb-ipaddresspool.yaml
\`\`\`

## 3. 部署阶段总览

完整推荐顺序：

\`\`\`text
01-cluster-create
02-machineconfig
03-metallb
04-ingress
05-egress
06-registry
07-victoriametrics-monitoring
08-autoscale-dashboard
09-clickhouse-log
10-integration-log-monitor
11-runocp
12-zabbix
13-security-compliance-sentinelone
14-etcd-backup
15-localdns
16-heartbeat-validation
17-registry-image-prune
\`\`\`

最小基础平台部署顺序：

\`\`\`text
01-cluster-create
02-machineconfig
03-metallb
04-ingress
06-registry
07-victoriametrics-monitoring
09-clickhouse-log
14-etcd-backup
16-heartbeat-validation
\`\`\`

## 4. 全局前置条件

### 4.1 权限和工具

需要具备：

- \`kubectl\`
- \`ac\`
- \`helm\`
- cluster-admin 权限
- global cluster 和 workload cluster 访问权限
- 创建或修改以下资源的权限：
  - CRD
  - ClusterRole / ClusterRoleBinding
  - ModuleInfo
  - ResourcePatch
  - Secret
  - Ingress
  - MachineConfig
  - MachineDeployment

### 4.2 平台能力

目标环境需要具备或即将部署：

- Cluster API / DCS controller
- ModuleInfo controller
- ResourcePatch controller
- Kube-OVN
- Multus
- MetalLB operator
- IngressNginx operator
- VictoriaMetrics operator
- Etcd backup controller
- Compliance operator，如需要合规扫描
- Kyverno，如需要命名空间策略
- AIT MonitorDashboard CRD，如需要自定义看板

### 4.3 网络规划

部署前必须确认：

- control plane IP
- worker IP
- ingress LoadBalancer IP
- MetalLB IP pool
- egress subnet
- egress external IP
- DNS server
- gateway
- cluster domain
- registry external domain
- platform ingress URL
- syslog server 地址和端口
- Zabbix server 地址

### 4.4 节点 label / taint 规划

多个组件依赖节点 label：

\`\`\`text
ingress: "true"
egress: ""
log: ""
monitor: ""
registry: ""
heartbeat: "true"
node-role.kubernetes.io/infra: ""
\`\`\`

infra 节点通常带 taint：

\`\`\`yaml
key: node-role.kubernetes.io/infra
effect: NoSchedule
\`\`\`

因此调度到 infra 节点的组件必须带 toleration。

### 4.5 证书、Secret、镜像

需要准备：

- registry TLS 证书和私钥
- default ingress TLS secret
- registry S3 access key / secret key
- etcd backup S3 access key / secret key
- ClickHouse S3 secret，如使用
- syslog CA cert，如日志或指标转发需要 TLS
- SentinelOne site key / token
- Zabbix server 地址
- proxy 地址，如 SentinelOne 需要
- 内部 registry 中的镜像，例如 heartbeat、Zabbix、SentinelOne、ac CLI 等

注意：本文档不会沉淀真实 token、密码、证书、客户数据和生产密钥。发布前必须脱敏。

## 5. 模块部署摘要

| 阶段 | 模块 | 主要资源 | 关键依赖 | 验证重点 |
|---|---|---|---|---|
| 01 | cluster-create | Cluster、DCSCluster、KubeadmControlPlane、MachineDeployment | CAPI / DCS、IP 规划、虚拟化认证 | Cluster、MachineDeployment、Node Ready |
| 02 | machineconfig | MachineConfig、MachineConfiguration | 集群和节点 Ready | MachineConfig 生效、节点滚动完成 |
| 03 | metallb | IPAddressPool、L2Advertisement、ModuleInfo | MetalLB operator、ingress IP 池 | LoadBalancer IP 可分配 |
| 04 | ingress | TLS Secret、IngressNginx | MetalLB、Ingress operator、ingress 节点 | ingress controller、LB IP、TLS |
| 05 | egress | NAD、Subnet、Vpc、VpcEgressGateway | Kube-OVN、Multus、egress 节点外部网卡 | 出口 Pod、VPC BFD、外部访问 |
| 06 | registry | TLS Secret、S3 Secret、ModuleInfo、Gateway | registry 节点、Ingress、S3 | push/pull、Ingress、Deployment 调度 |
| 07 | victoriametrics | ModuleInfo、adapter 修复 | monitor 节点、StorageClass | VM 组件、PVC、kubectl top |
| 08 | autoscale-dashboard | prometheus-adapter CM、MonitorDashboard | VictoriaMetrics、custom.metrics API | HPA 指标和看板 |
| 09 | clickhouse-log | ClickHouse、logagent、ResourcePatch、Secret | log 节点、S3、syslog CA | ClickHouse、razor、logagent、rpch |
| 10 | integration-log-monitor | vector/syslog、metric-forwarder、remoteWrite | 日志和监控组件已部署 | 外部 syslog / metric 接收端有数据 |
| 11 | runocp | SA、ClusterRole、RoleTemplate、Namespace 策略 | Kyverno、网络策略、安全评审 | RBAC、Quota、LimitRange、NetworkPolicy |
| 12 | zabbix | Helm chart、Proxy、Agent、Exporter | Zabbix server、内部镜像、monitor 节点 | proxy/agent 在线、token 可用 |
| 13 | security | Compliance Scan、SentinelOne | Compliance CRD、SentinelOne 镜像和凭据 | scan 结果、agent DaemonSet |
| 14 | etcd-backup | EtcdBackupConfiguration、S3 Secret | S3 endpoint、controller、控制平面访问 S3 | backup 对象生成并上传 S3 |
| 15 | localdns | kube-ovn-controller patch | Kube-OVN、NodeLocal DNS 方案 | 参数生效、controller 正常 |
| 16 | heartbeat | Namespace、Deployment、Service、Ingress | Ingress、httpd 镜像 | global/workload heartbeat 可访问 |
| 17 | registry-image-prune | CronJob | registry 可用、ac 镜像、RBAC | dry-run、手动 job、日志 |

## 6. 推荐执行 Runbook

### 6.1 集群创建

用途：创建 workload cluster / ACP 集群，包括 control plane、worker 和 infra 节点组。

关键文件：

\`\`\`text
deployment/cluster-create/dcs-authentication/secret.yaml
deployment/cluster-create/Cluster/Cluster.yaml
deployment/cluster-create/DCSCluster/DCSCluster.yaml
deployment/cluster-create/DCSIpHostnamePool/DCSIpHostnamePool.yaml
deployment/cluster-create/DCSMachineTemplate/DCSMachineTemplate.yaml
deployment/cluster-create/KubeadmControlPlane/KubeadmControlPlane.yaml
deployment/cluster-create/machinedeployment/*.yaml
\`\`\`

执行：

\`\`\`bash
kubectl apply -f deployment/cluster-create/dcs-authentication/secret.yaml
kubectl apply -f deployment/cluster-create/Cluster/Cluster.yaml
kubectl apply -f deployment/cluster-create/DCSCluster/DCSCluster.yaml
kubectl apply -f deployment/cluster-create/DCSIpHostnamePool/DCSIpHostnamePool.yaml
kubectl apply -f deployment/cluster-create/DCSMachineTemplate/DCSMachineTemplate.yaml
kubectl apply -f deployment/cluster-create/KubeadmControlPlane/KubeadmControlPlane.yaml
kubectl apply -f deployment/cluster-create/machinedeployment/ingress.yaml
kubectl apply -f deployment/cluster-create/machinedeployment/egress.yaml
kubectl apply -f deployment/cluster-create/machinedeployment/log.yaml
kubectl apply -f deployment/cluster-create/machinedeployment/registry.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get cluster
kubectl get dcscluster
kubectl get kubeadmcontrolplane
kubectl get machinedeployment -A
kubectl get nodes -o wide
kubectl get nodes --show-labels
\`\`\`

### 6.2 MachineConfig

用途：配置 chrony、timezone、issue banner、MachineConfiguration。

执行：

\`\`\`bash
kubectl apply -f deployment/machineconfig/99-master-chrony.yaml
kubectl apply -f deployment/machineconfig/99-worker-chrony.yaml
kubectl apply -f deployment/machineconfig/99-master-timezone-sgt-systemd.yaml
kubectl apply -f deployment/machineconfig/99-worker-timezone-sgt-systemd.yaml
kubectl apply -f deployment/machineconfig/99-master-issue.yaml
kubectl apply -f deployment/machineconfig/99-wokrer-issue.yaml
kubectl apply -f deployment/machineconfig/cluster-machineconfiguration.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get machineconfig
kubectl get machineconfiguration
kubectl get nodes
kubectl get mcp
\`\`\`

风险：MachineConfig 可能触发节点滚动更新，建议在维护窗口执行。

### 6.3 MetalLB

用途：为 IngressNginx 提供 LoadBalancer IP。

执行：

\`\`\`bash
kubectl apply -f deployment/metallb/metallb-minfo.yaml
kubectl apply -f deployment/metallb/ipaddresspool.yaml
kubectl apply -f deployment/metallb/l2advertisement.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get ipaddresspool -n metallb-system
kubectl get l2advertisement -n metallb-system
kubectl get pods -n metallb-system
\`\`\`

### 6.4 IngressNginx

用途：提供集群 HTTP/HTTPS 入口。

执行：

\`\`\`bash
kubectl apply -f deployment/ingress/default-app-tls.yaml
kubectl apply -f deployment/ingress/ingressnginx.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get ingressnginx -n ingress-nginx-operator
kubectl get svc -n ingress-nginx-operator
kubectl get pods -n ingress-nginx-operator -o wide
\`\`\`

重点确认：

- \`proxy-body-size: "0"\`
- LoadBalancer IP 正确分配
- ingress controller 调度到 ingress 节点

### 6.5 Egress

用途：配置 Kube-OVN Multus/macvlan 外部网络和 VpcEgressGateway。

执行：

\`\`\`bash
kubectl apply -f deployment/egress/multus-minfo.yaml
kubectl apply -f deployment/egress/fixed.yaml
\`\`\`

然后按现场规划编辑 VPC：

\`\`\`bash
kubectl edit vpc ovn-cluster
\`\`\`

确认 BFD 配置：

\`\`\`yaml
spec:
  bfdPort:
    enabled: true
    ip: 10.255.255.255
    nodeSelector:
      matchLabels:
        egress: ""
\`\`\`

再部署 egress gateway：

\`\`\`bash
kubectl apply -f deployment/egress/veg.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get network-attachment-definitions -A
kubectl get subnet
kubectl get vpc ovn-cluster -o yaml
kubectl get vpcegressgateway -A
kubectl get pods -A -o wide | grep -i egress
\`\`\`

### 6.6 Registry

用途：配置平台内部 registry、registry gateway、TLS、S3 和镜像清理策略。

执行：

\`\`\`bash
kubectl apply -f deployment/registry/registry-ssl.yaml
kubectl apply -f deployment/registry/registry-s3-secret.yaml
kubectl apply -f deployment/registry/registry-minfo.yaml
kubectl apply -f deployment/registry/registry-gateway-minfo.yaml
\`\`\`

如需调整调度：

\`\`\`bash
ac patch deployment -n cpaas-system image-registry \\
  --type='merge' \\
  -p='{"spec":{"template":{"spec":{"nodeSelector":{"registry":""}}}}}'

ac patch deployment -n cpaas-system registry-gateway-gateway \\
  --type='merge' \\
  -p='{"spec":{"template":{"spec":{"nodeSelector":{"registry":""}}}}}'
\`\`\`

验证：

\`\`\`bash
kubectl get secret -n cpaas-system registry-ssl registry-s3-secret
kubectl get deploy -n cpaas-system image-registry registry-gateway-gateway -o wide
kubectl get ingress -n cpaas-system
\`\`\`

并验证镜像 push/pull。

### 6.7 VictoriaMetrics 和自定义指标

部署 VictoriaMetrics：

\`\`\`bash
kubectl apply -f deployment/victoriametrics/vm.yaml
\`\`\`

如需要 prometheus-adapter 修复：

\`\`\`bash
kubectl apply -f deployment/victoriametrics/bug-fix/adapter-cm.yaml
\`\`\`

自定义指标和 Dashboard：

\`\`\`bash
kubectl apply -f deployment/autoscale-metrics/prometheus-adapter-cm.yaml
kubectl apply -f deployment/dashboard.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get minfo -A | grep -i victoriametrics
kubectl get pods -n cpaas-system | grep -Ei 'victoria|vmagent|vmalert|adapter'
kubectl get pvc -n cpaas-system
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | head
kubectl get monitordashboard
\`\`\`

### 6.8 ClickHouse 日志链路

用途：部署或配置 ClickHouse、logagent、razor、syslog secret 和 ResourcePatch。

执行：

\`\`\`bash
kubectl apply -f deployment/clickhouse/s3-secret.yaml
kubectl apply -f deployment/clickhouse/secret-syslog.yaml
kubectl apply -f deployment/clickhouse/log-clickhouse-minfo.yaml
kubectl apply -f deployment/clickhouse/logagent-minfo.yaml
kubectl apply -f deployment/clickhouse/rp-click.yaml
kubectl apply -f deployment/clickhouse/rp-razor.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get secret -n cpaas-system | grep -Ei 'clickhouse|syslog'
kubectl get pods -n cpaas-system -o wide | grep -Ei 'clickhouse|razor|log'
kubectl get rpch -A
kubectl get minfo -A | grep -Ei 'log|clickhouse'
\`\`\`

### 6.9 日志和指标外部转发

日志转发通常不是直接 apply，而是：

1. 导出 \`cpaas-vector\` secret 中的 \`vector.yaml\`。
2. 修改 transforms 和 sinks。
3. patch 回 secret。
4. 如启用 TLS，给 razor/vector 挂载 syslog CA secret。

指标转发通常是：

1. 找到 VictoriaMetrics ModuleInfo。
2. 编辑 ModuleInfo 增加 remoteWrite。
3. 修改 \`metric-forwarder-vector-config\` secret。
4. 如启用 TLS，挂载 CA secret。

验证：

\`\`\`bash
kubectl get secret -n cpaas-system cpaas-vector -o yaml
kubectl get secret -n cpaas-system metric-forwarder-vector-config -o yaml
kubectl get pods -n cpaas-system | grep -Ei 'vector|metric-forwarder|razor'
\`\`\`

并在外部 syslog / metric 接收端确认数据。

### 6.10 RunOCP 自动化账号和命名空间策略

用途：创建自动化 namespace、ServiceAccount、ClusterRole、ClusterRoleBinding、RoleTemplate、NetworkPolicy、ResourceQuota、LimitRange、Kyverno Policy。

执行顺序：

\`\`\`bash
kubectl apply -f deployment/integration/runocp/global-roletemplate/
kubectl apply -f deployment/integration/runocp/global-clusterrole/
kubectl apply -f deployment/integration/runocp/workload-cluster/
kubectl apply -f deployment/integration/runocp/namespace/namespace.yaml
kubectl apply -f deployment/integration/runocp/namespace/resourcequato.yaml
kubectl apply -f deployment/integration/runocp/namespace/limitrange.yaml
kubectl apply -f deployment/integration/runocp/namespace/networkpolicy.yaml
kubectl apply -f deployment/integration/runocp/namespace/kyvernopolicy.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get ns
kubectl get sa -A | grep paas-bot-api
kubectl get clusterrole | grep runocp
kubectl get clusterrolebinding | grep runocp
kubectl get roletemplate -A
kubectl get networkpolicy -n <namespace>
kubectl get resourcequota -n <namespace>
kubectl get limitrange -n <namespace>
\`\`\`

风险：RBAC 权限较大，必须经过安全评审，避免给自动化账号授予过宽权限。

### 6.11 Zabbix

用途：部署 Zabbix proxy、agent、exporter，对接外部 Zabbix server。

Helm 部署：

\`\`\`bash
helm upgrade --install zabbix deployment/zabbix/zabbix \\
  -n zabbix --create-namespace \\
  -f deployment/zabbix/zabbix/values-zabbixproxy.yaml
\`\`\`

integration 文件：

\`\`\`bash
kubectl apply -f deployment/integration/zabbix/exporter-kube-state.yaml
kubectl apply -f deployment/integration/zabbix/zabbix.yaml
kubectl apply -f deployment/integration/zabbix/zabbix-deployment.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get pods -n zabbix -o wide
kubectl get svc -n zabbix
kubectl get sa -n zabbix
kubectl get secret zabbix-service-account -n zabbix -o jsonpath='{.data.token}' | base64 -d
\`\`\`

### 6.12 安全合规和 SentinelOne

Compliance：

\`\`\`bash
kubectl apply -f deployment/compliance-operator/moduleinfo.yaml
kubectl apply -f deployment/compliance-operator/basic-scan.yaml
kubectl apply -f deployment/compliance-operator/Scheduled.yaml
\`\`\`

SentinelOne：

\`\`\`bash
helm upgrade --install sentinelone <chart-path> \\
  -n sentinelone --create-namespace \\
  -f deployment/sentinelone/values.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get minfo -A | grep -i compliance
kubectl get scan -A
kubectl get scansuite -A
kubectl get pods -n sentinelone -o wide
kubectl get daemonset -n sentinelone
\`\`\`

### 6.13 Etcd Backup

创建 S3 secret：

\`\`\`bash
export ACCESS_KEY="<redacted-access-key>"
export SECRET_KEY="<redacted-secret-key>"

kubectl create secret generic etcd-backup-s3-secret \\
  --from-literal=ACCESS_KEY="$ACCESS_KEY" \\
  --from-literal=SECRET_KEY="$SECRET_KEY" \\
  --dry-run=client -n cpaas-system -o yaml | kubectl apply -f -
\`\`\`

应用备份配置：

\`\`\`bash
kubectl apply -f deployment/etcdbackupconfiguration/change-dir-date.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get etcdbackupconfiguration
kubectl get secret -n cpaas-system etcd-backup-s3-secret
aws s3 --endpoint https://<s3-url> ls s3://<bucket-name>/<dir> --profile <profile> --no-verify-ssl
\`\`\`

### 6.14 LocalDNS

用途：给 kube-ovn-controller 增加 node-local-dns-ip 参数。

执行：

\`\`\`bash
ac patch deploy -n kube-system kube-ovn-controller --type=json \\
  --patch='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--node-local-dns-ip=169.254.0.10"}]'
\`\`\`

验证：

\`\`\`bash
kubectl get deploy -n kube-system kube-ovn-controller -o yaml | grep node-local-dns-ip
kubectl get pods -n kube-system | grep kube-ovn-controller
\`\`\`

### 6.15 Heartbeat 验证

Global：

\`\`\`bash
kubectl apply -f deployment/heartbeat/global/ns.yaml
kubectl apply -f deployment/heartbeat/global/deployment.yaml
kubectl apply -f deployment/heartbeat/global/svc.yaml
kubectl apply -f deployment/heartbeat/global/ingress.yaml
\`\`\`

Workload：

\`\`\`bash
kubectl apply -f deployment/heartbeat/workload/ns.yaml
kubectl apply -f deployment/heartbeat/workload/deployment.yaml
kubectl apply -f deployment/heartbeat/workload/svc.yaml
kubectl apply -f deployment/heartbeat/workload/ingress.yaml
\`\`\`

验证：

\`\`\`bash
kubectl get ns acp-heartbeat
kubectl get deploy,svc,ingress -n acp-heartbeat
curl -k https://<heartbeat-domain>
\`\`\`

### 6.16 Registry Image Prune

先 dry-run：

\`\`\`bash
ac adm prune images
\`\`\`

部署 CronJob：

\`\`\`bash
kubectl apply -f deployment/registry/image-prune/cronjob.yaml
\`\`\`

手动触发验证：

\`\`\`bash
kubectl create job --from=cronjob/ac-prune-images-cronjob \\
  ac-prune-images-cronjob-manual -n cpaas-system
\`\`\`

验证：

\`\`\`bash
kubectl get cronjob -n cpaas-system ac-prune-images-cronjob
kubectl get job -n cpaas-system ac-prune-images-cronjob-manual
kubectl logs -n cpaas-system job/ac-prune-images-cronjob-manual
\`\`\`

## 7. 部署前检查清单

执行前逐项确认：

- [ ] 所有 \`<xxx>\` 占位符已替换。
- [ ] 所有示例环境名已替换为目标环境。
- [ ] 所有 IP、CIDR、gateway 已按目标环境修改。
- [ ] 所有 domain/host 已按目标环境修改。
- [ ] 所有 Secret 不再使用示例值。
- [ ] registry TLS 可用。
- [ ] ingress default TLS 可用。
- [ ] S3 endpoint 可达。
- [ ] syslog server 可达。
- [ ] 节点 label 正确。
- [ ] infra taint 对应组件已有 toleration。
- [ ] ResourcePatch 目标资源已存在。
- [ ] Helm template 没有被直接 apply。
- [ ] 合并版文件没有和拆分版重复 apply。
- [ ] 已对关键 YAML 执行 dry-run。

## 8. 部署后验证清单

部署完成后建议执行：

\`\`\`bash
kubectl get nodes -o wide
kubectl get nodes --show-labels
kubectl get pods -A | grep -Ev 'Running|Completed'
kubectl get ingress -A
kubectl get svc -A | grep LoadBalancer
kubectl get pvc -A
kubectl get minfo -A
kubectl get rpch -A
\`\`\`

重点验证：

- ingress 域名可访问。
- registry 可以 push/pull。
- egress namespace 可以出网。
- VictoriaMetrics 可以查询指标。
- prometheus-adapter custom metrics 可用。
- ClickHouse / 日志组件正常。
- syslog 能收到日志或指标。
- etcd backup 已生成并上传 S3。
- Zabbix proxy/agent 在线。
- Compliance Scan 有结果。
- SentinelOne Agent 在线。
- heartbeat global/workload 均可访问。

## 9. 回滚建议

### 9.1 通用回滚原则

- 优先回滚最近一次变更，不要直接删除整个模块。
- Secret、证书、S3、外部系统配置要保留备份。
- 对 MachineConfig、网络、Ingress、Registry 等高风险变更，必须在维护窗口操作。
- ResourcePatch 回滚前要确认 patch 影响的目标资源和字段。

### 9.2 常用回滚命令

查看资源：

\`\`\`bash
kubectl get <kind> -A
kubectl describe <kind> <name> -n <namespace>
\`\`\`

删除单个错误资源：

\`\`\`bash
kubectl delete -f <file>
\`\`\`

Helm 回滚：

\`\`\`bash
helm history <release> -n <namespace>
helm rollback <release> <revision> -n <namespace>
\`\`\`

Deployment 回滚：

\`\`\`bash
kubectl rollout history deploy/<name> -n <namespace>
kubectl rollout undo deploy/<name> -n <namespace>
\`\`\`

## 10. 风险点总结

| 风险 | 说明 | 建议 |
|---|---|---|
| 整目录 apply | 混合了模板、说明、示例和真实资源 | 必须按阶段和文件执行 |
| Secret 泄露 | TLS、S3、token、authKey 等可能出现在 YAML | 发布前脱敏，生产用 Secret 管理 |
| 示例环境残留 | 文件中可能含示例集群名、域名、IP | 发布前统一替换 |
| MachineConfig 滚动 | 可能触发节点重启或滚动 | 维护窗口执行 |
| ResourcePatch 提前执行 | 目标资源不存在会失败或不可预测 | 先确认目标资源存在 |
| Helm 模板误 apply | 模板文件不能直接 kubectl apply | 使用 Helm render/install |
| 网络配置错误 | ingress / egress / MetalLB 影响业务流量 | 先验证 IP 池、网关、BFD、路由 |
| RBAC 过宽 | runocp 自动化权限较大 | 安全评审、最小权限 |
| 外部集成不可达 | syslog、Zabbix、S3、proxy 依赖外部系统 | 部署前做连通性验证 |

## 11. 相关文档

- [[Vector 日志输出到 Kafka 最佳实践]]
`,i=`---
title: Vector 日志输出到 Kafka 最佳实践
type: runbook
category: devops
tags:
  - vector
  - kafka
  - logging
  - observability
  - runbook
  - best-practice
created: 2026-05-29
updated: 2026-05-29
status: active
source: chat
owner: unknown
---

# Vector 日志输出到 Kafka 最佳实践

## 1. 目的

记录如何在 Vector 中新增 Kafka sink，将采集到的日志输出到 Kafka，并给出生产环境推荐配置、可靠性参数、性能参数、风险点和验证方式。

## 2. 适用范围

- Vector 作为日志采集/转发组件
- Kafka 作为日志缓冲、解耦或下游消费入口
- Kubernetes、虚拟机、裸机均适用
- 常见链路：

\`\`\`text
application logs -> Vector source -> Vector transform -> Kafka sink -> consumer / Flink / Logstash / ClickHouse / Elasticsearch
\`\`\`

## 3. 推荐架构

### 3.1 单集群通用链路

\`\`\`text
App / Container Logs
        |
        v
Vector Agent / Aggregator
        |
        v
Kafka Topic: logs.<env>.<service>
        |
        +--> Real-time consumer
        +--> Stream processing
        +--> Long-term storage
\`\`\`

### 3.2 Agent + Aggregator 模式

生产环境更推荐：

\`\`\`text
Vector Agent DaemonSet
        |
        | vector sink / kafka sink
        v
Vector Aggregator Deployment
        |
        v
Kafka
\`\`\`

适用场景：

- 节点较多
- 日志量大
- 希望在 Aggregator 层统一清洗、脱敏、路由、限流
- 避免每个节点都直接连接 Kafka，降低 Kafka broker 连接数压力

如果规模较小，也可以 Agent 直接输出到 Kafka。

## 4. 最小可用配置

以下示例将文件日志采集后输出到 Kafka。

\`\`\`toml
[sources.app_logs]
type = "file"
include = ["/var/log/app/*.log"]
read_from = "end"

[transforms.parse_logs]
type = "remap"
inputs = ["app_logs"]
source = '''
.service = "demo-service"
.env = "test"
.log_type = "application"
'''

[sinks.kafka_logs]
type = "kafka"
inputs = ["parse_logs"]
bootstrap_servers = "kafka-0.kafka:9092,kafka-1.kafka:9092,kafka-2.kafka:9092"
topic = "logs.test.demo-service"
encoding.codec = "json"
\`\`\`

## 5. 生产推荐配置

\`\`\`toml
[sources.kubernetes_logs]
type = "kubernetes_logs"

[transforms.normalize_logs]
type = "remap"
inputs = ["kubernetes_logs"]
source = '''
# 基础字段标准化
.env = get_env_var("ENV") ?? "unknown"
.cluster = get_env_var("CLUSTER_NAME") ?? "unknown"
.log_type = "application"

# Kubernetes 常用字段兜底
.namespace = .kubernetes.pod_namespace ?? "unknown"
.pod = .kubernetes.pod_name ?? "unknown"
.container = .kubernetes.container_name ?? "unknown"
.node = .kubernetes.pod_node_name ?? "unknown"

# 应用名优先取 label，不存在再使用 container 名称
.service = .kubernetes.pod_labels."app.kubernetes.io/name" ?? .kubernetes.pod_labels.app ?? .container

# 统一时间字段
.ingest_ts = now()
'''

[sinks.kafka_logs]
type = "kafka"
inputs = ["normalize_logs"]
bootstrap_servers = "kafka-0.kafka:9092,kafka-1.kafka:9092,kafka-2.kafka:9092"
topic = "logs.{{ env }}.{{ namespace }}"
encoding.codec = "json"

# 推荐按服务或 Pod 维度作为 key，保证同一 key 有序
key_field = "service"

# 压缩建议开启，降低 Kafka 网络和磁盘压力
compression = "lz4"

# Kafka ack 策略：生产建议 all，可靠性优先
acknowledgements.enabled = true
acknowledgements.timeout_secs = 30

# 批量发送：根据吞吐和延迟要求调优
batch.max_events = 1000
batch.timeout_secs = 1

# 请求超时
request.timeout_secs = 30

# Buffer：建议生产使用磁盘 buffer，防止 Kafka 短暂不可用导致日志大量丢失
buffer.type = "disk"
buffer.max_size = 10737418240 # 10GiB
buffer.when_full = "block"

# 健康检查
healthcheck.enabled = true
\`\`\`

说明：

- \`topic = "logs.{{ env }}.{{ namespace }}"\` 表示动态 topic，具体字段必须在事件中存在。
- 如果 Kafka 不允许自动创建 topic，需要提前创建好所有可能的 topic。
- 如果不希望动态 topic，建议固定为 \`logs.<env>.application\`，再由下游按字段分流。

## 6. Kafka Topic 规划最佳实践

### 6.1 Topic 命名

推荐：

\`\`\`text
logs.<env>.<domain>
logs.<env>.<namespace>
logs.<env>.<service>
\`\`\`

示例：

\`\`\`text
logs.prod.payment
logs.prod.default
logs.uat.file-service
\`\`\`

不建议：

\`\`\`text
logs
all-logs
app
\`\`\`

原因：

- 不利于权限控制
- 不利于生命周期管理
- 不利于下游消费隔离
- 单 topic 容易过热

### 6.2 Topic 粒度建议

| 粒度 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| 全部日志一个 topic | 简单 | 容易过热，权限和消费隔离差 | 不推荐生产 |
| 按环境分 topic | 简单清晰 | 大环境中仍可能过热 | 小规模可用 |
| 按 namespace/domain 分 topic | 隔离较好 | topic 数量中等 | 推荐 |
| 按 service 分 topic | 隔离最好 | topic 数量多，管理成本高 | 大规模或关键服务使用 |

推荐默认：

\`\`\`text
logs.<env>.<namespace>
\`\`\`

关键业务可单独拆：

\`\`\`text
logs.prod.payment
logs.prod.file-service
\`\`\`

## 7. 可靠性最佳实践

### 7.1 使用磁盘 Buffer

Kafka 短暂不可用、网络抖动、broker 滚动重启时，内存 buffer 很容易丢数据或撑爆内存。

推荐：

\`\`\`toml
buffer.type = "disk"
buffer.max_size = 10737418240
buffer.when_full = "block"
\`\`\`

含义：

- \`disk\`：写入本地磁盘缓冲
- \`max_size\`：按节点或实例容量评估
- \`block\`：buffer 满时阻塞上游，优先保护数据不丢

如果业务更关注应用不受日志链路影响，可以考虑：

\`\`\`toml
buffer.when_full = "drop_newest"
\`\`\`

但要明确接受日志丢失风险。

### 7.2 Kafka ack 推荐

生产环境建议可靠性优先：

\`\`\`toml
acknowledgements.enabled = true
acknowledgements.timeout_secs = 30
\`\`\`

Kafka topic 侧建议：

\`\`\`properties
acks=all
min.insync.replicas=2
replication.factor=3
\`\`\`

### 7.3 避免无限动态 topic

动态 topic 很方便，但风险很高：

- label 异常导致创建大量 topic
- namespace/service 名称不受控
- Kafka controller 压力增大
- 权限策略复杂化

建议：

1. 生产环境优先使用有限集合 topic。
2. 动态 topic 字段必须做白名单或归一化。
3. Kafka 禁止自动创建 topic，由平台预创建。

## 8. 性能最佳实践

### 8.1 开启压缩

推荐优先使用：

\`\`\`toml
compression = "lz4"
\`\`\`

选择建议：

| 压缩 | 特点 | 建议 |
|---|---|---|
| lz4 | 速度快，压缩率适中 | 日志场景推荐 |
| gzip | 压缩率高，CPU 成本高 | 带宽极紧张时使用 |
| snappy | 通用平衡 | 可用 |
| none | 无 CPU 成本，但网络/磁盘压力大 | 不推荐生产大流量 |

### 8.2 批量参数

吞吐优先：

\`\`\`toml
batch.max_events = 5000
batch.timeout_secs = 2
\`\`\`

低延迟优先：

\`\`\`toml
batch.max_events = 500
batch.timeout_secs = 0.5
\`\`\`

通用推荐：

\`\`\`toml
batch.max_events = 1000
batch.timeout_secs = 1
\`\`\`

### 8.3 key_field 设计

推荐：

\`\`\`toml
key_field = "service"
\`\`\`

或：

\`\`\`toml
key_field = "pod"
\`\`\`

选择原则：

- 同一个 key 会进入同一个 partition，可保持局部有序。
- key 过于集中会导致 partition 热点。
- 不建议固定 key。
- 高吞吐场景可以考虑不设置 key 或使用更分散字段。

## 9. 安全配置示例

### 9.1 SASL/SCRAM 示例

\`\`\`toml
[sinks.kafka_logs]
type = "kafka"
inputs = ["normalize_logs"]
bootstrap_servers = "kafka-0.kafka:9093,kafka-1.kafka:9093,kafka-2.kafka:9093"
topic = "logs.prod.application"
encoding.codec = "json"

sasl.enabled = true
sasl.mechanism = "SCRAM-SHA-512"
sasl.username = "\${KAFKA_USERNAME}"
# 从环境变量或 Secret 注入，不要在配置文件中写真实密码
sasl.password = "\${KAFKA_PASSWORD}"

tls.enabled = true
\`\`\`

注意：

- 不要把 Kafka 密码写死在配置文件中。
- Kubernetes 中建议使用 Secret 注入环境变量或挂载文件。
- 生产环境建议启用 TLS。

### 9.2 Kubernetes Secret 示例

\`\`\`yaml
apiVersion: v1
kind: Secret
metadata:
  name: vector-kafka-auth
  namespace: observability
type: Opaque
stringData:
  KAFKA_USERNAME: vector-writer
  KAFKA_PASSWORD: "REDACTED"
\`\`\`

Deployment/DaemonSet 中引用：

\`\`\`yaml
envFrom:
  - secretRef:
      name: vector-kafka-auth
\`\`\`

## 10. Kubernetes ConfigMap 示例

\`\`\`yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: vector-config
  namespace: observability
data:
  vector.toml: |
    [sources.kubernetes_logs]
    type = "kubernetes_logs"

    [transforms.normalize_logs]
    type = "remap"
    inputs = ["kubernetes_logs"]
    source = '''
    .env = get_env_var("ENV") ?? "unknown"
    .cluster = get_env_var("CLUSTER_NAME") ?? "unknown"
    .namespace = .kubernetes.pod_namespace ?? "unknown"
    .pod = .kubernetes.pod_name ?? "unknown"
    .container = .kubernetes.container_name ?? "unknown"
    .service = .kubernetes.pod_labels."app.kubernetes.io/name" ?? .kubernetes.pod_labels.app ?? .container
    .ingest_ts = now()
    '''

    [sinks.kafka_logs]
    type = "kafka"
    inputs = ["normalize_logs"]
    bootstrap_servers = "kafka-0.kafka:9092,kafka-1.kafka:9092,kafka-2.kafka:9092"
    topic = "logs.{{ env }}.{{ namespace }}"
    encoding.codec = "json"
    key_field = "service"
    compression = "lz4"

    acknowledgements.enabled = true
    acknowledgements.timeout_secs = 30

    batch.max_events = 1000
    batch.timeout_secs = 1

    request.timeout_secs = 30

    buffer.type = "disk"
    buffer.max_size = 10737418240
    buffer.when_full = "block"

    healthcheck.enabled = true
\`\`\`

## 11. 验证方式

### 11.1 检查 Vector 配置

\`\`\`bash
vector validate /etc/vector/vector.toml
\`\`\`

Kubernetes 中：

\`\`\`bash
kubectl exec -n observability ds/vector -- vector validate /etc/vector/vector.toml
\`\`\`

### 11.2 查看 Vector Pod 状态

\`\`\`bash
kubectl get pod -n observability -l app=vector -o wide
kubectl logs -n observability -l app=vector --tail=200
\`\`\`

### 11.3 检查 Kafka topic

\`\`\`bash
kafka-topics.sh \\
  --bootstrap-server kafka-0.kafka:9092 \\
  --list | grep '^logs\\.'
\`\`\`

### 11.4 消费验证

\`\`\`bash
kafka-console-consumer.sh \\
  --bootstrap-server kafka-0.kafka:9092 \\
  --topic logs.test.default \\
  --from-beginning \\
  --max-messages 10
\`\`\`

### 11.5 查看 Vector 内部指标

如果启用了 Vector API 或 Prometheus exporter，应关注：

- sink 发送成功数
- sink 发送失败数
- buffer 使用量
- Kafka request latency
- dropped events
- retries

## 12. 风险说明

| 风险 | 说明 | 建议 |
|---|---|---|
| Kafka 不可用 | Vector buffer 持续增长 | 使用 disk buffer，配置告警 |
| buffer 满 | 可能阻塞或丢日志 | 根据业务选择 \`block\` 或 \`drop_newest\` |
| topic 过多 | Kafka controller 压力增大 | 限制动态 topic，预创建 topic |
| key 分布不均 | partition 热点 | 选择更分散的 key 或取消 key |
| 日志包含敏感信息 | 可能造成合规风险 | Vector transform 中脱敏 |
| 直接写死密码 | 凭证泄露 | 使用 Secret 或环境变量 |
| batch 太大 | 延迟升高 | 根据吞吐/延迟目标调优 |
| batch 太小 | 吞吐下降，broker 压力增大 | 生产压测后确定参数 |

## 13. 回滚方案

### 13.1 回滚 Vector 配置

如果通过 ConfigMap 管理：

\`\`\`bash
kubectl rollout history ds/vector -n observability
kubectl rollout undo ds/vector -n observability
\`\`\`

如果使用 Helm：

\`\`\`bash
helm history vector -n observability
helm rollback vector <REVISION> -n observability
\`\`\`

### 13.2 临时停用 Kafka sink

可以先从 Vector 配置中移除 Kafka sink，或将 sink inputs 指向空的 transform。

建议优先回滚到上一版配置，而不是临时手改生产配置。

### 13.3 防止 Kafka 被打爆

紧急情况下可：

1. 降低 Vector 副本数或暂停部分 Agent。
2. 调整采集范围。
3. 临时增大 Kafka topic partition。
4. 临时增大 Kafka broker 资源。
5. 切换 buffer 策略，但必须明确是否接受丢日志。

生产操作前必须确认影响范围。

## 14. 推荐默认配置总结

\`\`\`toml
[sinks.kafka_logs]
type = "kafka"
inputs = ["normalize_logs"]
bootstrap_servers = "kafka-0.kafka:9092,kafka-1.kafka:9092,kafka-2.kafka:9092"
topic = "logs.prod.application"
encoding.codec = "json"
key_field = "service"
compression = "lz4"
acknowledgements.enabled = true
acknowledgements.timeout_secs = 30
batch.max_events = 1000
batch.timeout_secs = 1
request.timeout_secs = 30
buffer.type = "disk"
buffer.max_size = 10737418240
buffer.when_full = "block"
healthcheck.enabled = true
\`\`\`

## 15. 相关链接

- Vector Kafka sink 官方文档：https://vector.dev/docs/reference/configuration/sinks/kafka/
- [[知识库规范]]
- [[标签体系]]
`,a=`---
title: ACP 平台部署组件依赖关系
type: architecture
category: devops
tags:
  - kubernetes
  - alauda
  - acp
  - architecture
  - deployment
  - dependency
  - platform-engineering
created: 2026-05-29
updated: 2026-05-29
status: active
source: project
---

# ACP 平台部署组件依赖关系

## 1. 背景

本文档从架构和依赖视角整理当前项目 \`deployment/\` 目录中的平台部署内容，帮助在交付、扩容、排障和变更时理解各模块之间的依赖关系。

## 2. 总体架构

\`\`\`text
Cluster API / DCS
        |
        v
Workload Cluster / ACP Cluster
        |
        +--> MachineConfig / MachineConfiguration
        |
        +--> Network Foundation
        |       +--> Kube-OVN
        |       +--> Multus
        |       +--> MetalLB
        |       +--> IngressNginx
        |       +--> VpcEgressGateway
        |
        +--> Platform Services
        |       +--> Registry / Registry Gateway
        |       +--> VictoriaMetrics
        |       +--> ClickHouse / LogAgent / Razor
        |       +--> Etcd Backup
        |
        +--> Integrations
        |       +--> Syslog / Vector
        |       +--> Metric Forwarder / remoteWrite
        |       +--> Zabbix
        |       +--> RunOCP Automation
        |
        +--> Security / Compliance
        |       +--> Compliance Operator
        |       +--> SentinelOne
        |
        +--> Validation
                +--> Heartbeat App
                +--> Dashboard
\`\`\`

## 3. 依赖分层

### 3.1 基础控制层

| 组件 | 作用 | 依赖 |
|---|---|---|
| Cluster API | 管理 Cluster、MachineDeployment 生命周期 | 管理集群 CRD / controller |
| DCSCluster | 对接底层虚拟化或 DCS 基础设施 | DCS 认证 Secret、endpoint |
| KubeadmControlPlane | 创建控制平面 | IP 池、MachineTemplate、kubeadm 配置 |
| MachineDeployment | 创建 worker / infra 节点组 | Cluster、MachineTemplate、IP 池 |

该层必须最先完成，否则后续所有模块都没有运行载体。

### 3.2 节点系统层

| 组件 | 作用 | 风险 |
|---|---|---|
| chrony MachineConfig | 时间同步 | 配置错误会影响证书、日志时间和 etcd |
| timezone MachineConfig | 设置时区 | 影响日志时间展示 |
| issue banner | 登录提示 | 低风险 |
| MachineConfiguration | 集群级节点配置 | 可能触发节点滚动 |

MachineConfig 可能触发节点更新，建议在集群创建完成且节点稳定后执行。

### 3.3 网络入口和出口层

| 组件 | 作用 | 上游依赖 | 下游依赖 |
|---|---|---|---|
| MetalLB | 分配 LoadBalancer IP | metallb-system、IP 池规划 | IngressNginx |
| IngressNginx | HTTP/HTTPS 入口 | MetalLB、TLS Secret、ingress 节点 | Registry Gateway、Heartbeat、平台入口 |
| Multus | 多网卡能力 | Multus operator | Egress macvlan |
| Kube-OVN Subnet/VPC | 集群网络和外部网络 | Kube-OVN | EgressGateway |
| VpcEgressGateway | 工作负载出网 | Multus、Kube-OVN、egress 节点 | 业务 namespace 出网 |

网络层是高风险层。Ingress 影响入站流量，Egress 影响出站流量，MetalLB IP 池冲突会直接导致服务不可访问。

### 3.4 平台基础服务层

| 组件 | 作用 | 依赖 |
|---|---|---|
| Registry | 内部镜像仓库 | registry 节点、S3、TLS |
| Registry Gateway | 暴露 registry 入口 | IngressNginx、TLS、registry |
| VictoriaMetrics | 监控存储和查询 | monitor 节点、StorageClass、ModuleInfo |
| ClickHouse | 日志存储 | log 节点、S3、ModuleInfo |
| LogAgent / Razor | 日志采集和处理 | ClickHouse、syslog CA、ResourcePatch |
| Etcd Backup | etcd 本地和远程备份 | S3、controller、控制平面访问外部存储 |

### 3.5 外部集成层

| 集成 | 数据方向 | 依赖 | 验证 |
|---|---|---|---|
| Vector / Syslog | 平台日志 -> 外部 syslog | vector secret、syslog CA、网络连通性 | 外部 syslog 收到日志 |
| Metric Forwarder | metrics -> 外部接收端 | VictoriaMetrics、remoteWrite、CA | 外部 metric 接收端有数据 |
| Zabbix | 集群监控 -> Zabbix server | proxy、agent、server 地址、镜像 | Zabbix 中 proxy/agent 在线 |
| RunOCP | 外部自动化 -> 集群 API | RBAC、SA token、RoleTemplate | 自动化账号可执行授权操作 |

### 3.6 安全合规层

| 组件 | 作用 | 注意事项 |
|---|---|---|
| Compliance Operator | STIG / OS / K8s 合规扫描 | 扫描计划、历史结果保留 |
| SentinelOne | 安全 Agent | site key、proxy、镜像、SCC/权限 |
| Kyverno Policy | namespace 级策略 | 可能阻断不合规资源创建 |
| NetworkPolicy | namespace 网络隔离 | 可能影响业务连通性 |

## 4. 推荐部署依赖图

\`\`\`text
01 cluster-create
   |
   v
02 machineconfig
   |
   v
03 metallb ------+
   |             |
   v             |
04 ingress <-----+
   |
   +--> 06 registry
   |       |
   |       +--> 17 image-prune
   |
   +--> 16 heartbeat

05 egress depends on Kube-OVN + Multus + egress nodes

07 victoriametrics
   |
   +--> 08 autoscale-dashboard
   +--> 10 metric-forwarder

09 clickhouse-log
   |
   +--> 10 log-forward

11 runocp depends on RBAC / Kyverno / namespace policy readiness
12 zabbix depends on monitor node and external Zabbix server
13 security depends on compliance CRD and SentinelOne assets
14 etcd-backup depends on S3 and backup controller
15 localdns depends on Kube-OVN controller
\`\`\`

## 5. 关键变更影响面

| 变更 | 可能影响 | 建议 |
|---|---|---|
| 修改 MetalLB IP 池 | 所有 LoadBalancer 服务 | 先确认 IP 不冲突，逐项验证服务 IP |
| 修改 IngressNginx | 平台入口和业务入口 | 维护窗口，保留上一版 YAML |
| 修改 EgressGateway | 出站流量 | 先验证路由和 BFD，再灰度 namespace |
| 修改 MachineConfig | 节点滚动或重启 | 维护窗口，观察 MCP/节点状态 |
| 修改 Registry | 镜像 push/pull | 先验证 registry gateway、S3、TLS |
| 修改 VictoriaMetrics | 监控、告警、HPA 指标 | 验证 custom.metrics API 和 VM 查询 |
| 修改 ClickHouse / LogAgent | 日志采集和查询 | 验证日志写入、查询、syslog 转发 |
| 修改 RunOCP RBAC | 自动化权限 | 安全评审，最小权限原则 |
| 修改 SentinelOne | 节点安全 Agent | 确认 proxy/site key/镜像版本 |
| 修改 Etcd Backup | 灾备能力 | 手动触发备份并验证 S3 对象 |

## 6. 发布前架构检查

- [ ] 是否明确 global cluster 和 workload cluster 操作边界。
- [ ] 是否区分初始部署、后续新增节点、单独修复和参考文件。
- [ ] 是否确认所有 ModuleInfo 适用于目标集群版本。
- [ ] 是否确认 ResourcePatch 目标资源已存在。
- [ ] 是否确认 Helm 模板不会被直接 apply。
- [ ] 是否确认 Secret、TLS、S3、token 不使用示例值。
- [ ] 是否确认网络入口、出口、DNS、证书和外部系统连通性。
- [ ] 是否准备每个高风险模块的回滚方案。

## 7. 相关文档

- [[ACP Deployment 部署顺序与模块总览]]
- [[Vector 日志输出到 Kafka 最佳实践]]
`,o={};function s(e){let t=o[e];if(t)return t;t=o[e]=[];for(let e=0;e<128;e++){let n=String.fromCharCode(e);t.push(n)}for(let n=0;n<e.length;n++){let r=e.charCodeAt(n);t[r]=`%`+(`0`+r.toString(16).toUpperCase()).slice(-2)}return t}function c(e,t){typeof t!=`string`&&(t=c.defaultChars);let n=s(t);return e.replace(/(%[a-f0-9]{2})+/gi,function(e){let t=``;for(let r=0,i=e.length;r<i;r+=3){let a=parseInt(e.slice(r+1,r+3),16);if(a<128){t+=n[a];continue}if((a&224)==192&&r+3<i){let n=parseInt(e.slice(r+4,r+6),16);if((n&192)==128){let e=a<<6&1984|n&63;e<128?t+=`��`:t+=String.fromCharCode(e),r+=3;continue}}if((a&240)==224&&r+6<i){let n=parseInt(e.slice(r+4,r+6),16),i=parseInt(e.slice(r+7,r+9),16);if((n&192)==128&&(i&192)==128){let e=a<<12&61440|n<<6&4032|i&63;e<2048||e>=55296&&e<=57343?t+=`���`:t+=String.fromCharCode(e),r+=6;continue}}if((a&248)==240&&r+9<i){let n=parseInt(e.slice(r+4,r+6),16),i=parseInt(e.slice(r+7,r+9),16),o=parseInt(e.slice(r+10,r+12),16);if((n&192)==128&&(i&192)==128&&(o&192)==128){let e=a<<18&1835008|n<<12&258048|i<<6&4032|o&63;e<65536||e>1114111?t+=`����`:(e-=65536,t+=String.fromCharCode(55296+(e>>10),56320+(e&1023))),r+=9;continue}}t+=`�`}return t})}c.defaultChars=`;/?:@&=+$,#`,c.componentChars=``;var l={};function u(e){let t=l[e];if(t)return t;t=l[e]=[];for(let e=0;e<128;e++){let n=String.fromCharCode(e);/^[0-9a-z]$/i.test(n)?t.push(n):t.push(`%`+(`0`+e.toString(16).toUpperCase()).slice(-2))}for(let n=0;n<e.length;n++)t[e.charCodeAt(n)]=e[n];return t}function d(e,t,n){typeof t!=`string`&&(n=t,t=d.defaultChars),n===void 0&&(n=!0);let r=u(t),i=``;for(let t=0,a=e.length;t<a;t++){let o=e.charCodeAt(t);if(n&&o===37&&t+2<a&&/^[0-9a-f]{2}$/i.test(e.slice(t+1,t+3))){i+=e.slice(t,t+3),t+=2;continue}if(o<128){i+=r[o];continue}if(o>=55296&&o<=57343){if(o>=55296&&o<=56319&&t+1<a){let n=e.charCodeAt(t+1);if(n>=56320&&n<=57343){i+=encodeURIComponent(e[t]+e[t+1]),t++;continue}}i+=`%EF%BF%BD`;continue}i+=encodeURIComponent(e[t])}return i}d.defaultChars=`;/?:@&=+$,-_.!~*'()#`,d.componentChars=`-_.!~*'()`;function f(e){let t=``;return t+=e.protocol||``,t+=e.slashes?`//`:``,t+=e.auth?e.auth+`@`:``,e.hostname&&e.hostname.indexOf(`:`)!==-1?t+=`[`+e.hostname+`]`:t+=e.hostname||``,t+=e.port?`:`+e.port:``,t+=e.pathname||``,t+=e.search||``,t+=e.hash||``,t}function p(){this.protocol=null,this.slashes=null,this.auth=null,this.port=null,this.hostname=null,this.hash=null,this.search=null,this.pathname=null}var m=/^([a-z0-9.+-]+:)/i,h=/:[0-9]*$/,g=/^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,_=[`%`,`/`,`?`,`;`,`#`,`'`,`{`,`}`,`|`,`\\`,`^`,"`",`<`,`>`,`"`,"`",` `,`\r`,`
`,`	`],v=[`/`,`?`,`#`],y=255,ee=/^[+a-z0-9A-Z_-]{0,63}$/,te=/^([+a-z0-9A-Z_-]{0,63})(.*)$/,ne={javascript:!0,"javascript:":!0},re={http:!0,https:!0,ftp:!0,gopher:!0,file:!0,"http:":!0,"https:":!0,"ftp:":!0,"gopher:":!0,"file:":!0};function ie(e,t){if(e&&e instanceof p)return e;let n=new p;return n.parse(e,t),n}p.prototype.parse=function(e,t){let n,r,i,a=e;if(a=a.trim(),!t&&e.split(`#`).length===1){let e=g.exec(a);if(e)return this.pathname=e[1],e[2]&&(this.search=e[2]),this}let o=m.exec(a);if(o&&(o=o[0],n=o.toLowerCase(),this.protocol=o,a=a.substr(o.length)),(t||o||a.match(/^\/\/[^@\/]+@[^@\/]+/))&&(i=a.substr(0,2)===`//`,i&&!(o&&ne[o])&&(a=a.substr(2),this.slashes=!0)),!ne[o]&&(i||o&&!re[o])){let e=-1;for(let t=0;t<v.length;t++)r=a.indexOf(v[t]),r!==-1&&(e===-1||r<e)&&(e=r);let t,n;n=e===-1?a.lastIndexOf(`@`):a.lastIndexOf(`@`,e),n!==-1&&(t=a.slice(0,n),a=a.slice(n+1),this.auth=t),e=-1;for(let t=0;t<_.length;t++)r=a.indexOf(_[t]),r!==-1&&(e===-1||r<e)&&(e=r);e===-1&&(e=a.length),a[e-1]===`:`&&e--;let i=a.slice(0,e);a=a.slice(e),this.parseHost(i),this.hostname=this.hostname||``;let o=this.hostname[0]===`[`&&this.hostname[this.hostname.length-1]===`]`;if(!o){let e=this.hostname.split(/\./);for(let t=0,n=e.length;t<n;t++){let n=e[t];if(n&&!n.match(ee)){let r=``;for(let e=0,t=n.length;e<t;e++)n.charCodeAt(e)>127?r+=`x`:r+=n[e];if(!r.match(ee)){let r=e.slice(0,t),i=e.slice(t+1),o=n.match(te);o&&(r.push(o[1]),i.unshift(o[2])),i.length&&(a=i.join(`.`)+a),this.hostname=r.join(`.`);break}}}}this.hostname.length>y&&(this.hostname=``),o&&(this.hostname=this.hostname.substr(1,this.hostname.length-2))}let s=a.indexOf(`#`);s!==-1&&(this.hash=a.substr(s),a=a.slice(0,s));let c=a.indexOf(`?`);return c!==-1&&(this.search=a.substr(c),a=a.slice(0,c)),a&&(this.pathname=a),re[n]&&this.hostname&&!this.pathname&&(this.pathname=``),this},p.prototype.parseHost=function(e){let t=h.exec(e);t&&(t=t[0],t!==`:`&&(this.port=t.substr(1)),e=e.substr(0,e.length-t.length)),e&&(this.hostname=e)};var ae=t({decode:()=>c,encode:()=>d,format:()=>f,parse:()=>ie}),oe=/[\0-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/,se=/[\0-\x1F\x7F-\x9F]/,ce=/[\xAD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|\uD804[\uDCBD\uDCCD]|\uD80D[\uDC30-\uDC3F]|\uD82F[\uDCA0-\uDCA3]|\uD834[\uDD73-\uDD7A]|\uDB40[\uDC01\uDC20-\uDC7F]/,le=/[!-#%-\*,-\/:;\?@\[-\]_\{\}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061D-\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1B7D\u1B7E\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u2E52-\u2E5D\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDEAD\uDF55-\uDF59\uDF86-\uDF89]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9]|\uD805[\uDC4B-\uDC4F\uDC5A\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDEB9\uDF3C-\uDF3E]|\uD806[\uDC3B\uDD44-\uDD46\uDDE2\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2\uDF00-\uDF09]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8\uDF43-\uDF4F\uDFFF]|\uD809[\uDC70-\uDC74]|\uD80B[\uDFF1\uDFF2]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD81B[\uDE97-\uDE9A\uDFE2]|\uD82F\uDC9F|\uD836[\uDE87-\uDE8B]|\uD83A[\uDD5E\uDD5F]/,ue=/[\$\+<->\^`\|~\xA2-\xA6\xA8\xA9\xAC\xAE-\xB1\xB4\xB8\xD7\xF7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u0384\u0385\u03F6\u0482\u058D-\u058F\u0606-\u0608\u060B\u060E\u060F\u06DE\u06E9\u06FD\u06FE\u07F6\u07FE\u07FF\u0888\u09F2\u09F3\u09FA\u09FB\u0AF1\u0B70\u0BF3-\u0BFA\u0C7F\u0D4F\u0D79\u0E3F\u0F01-\u0F03\u0F13\u0F15-\u0F17\u0F1A-\u0F1F\u0F34\u0F36\u0F38\u0FBE-\u0FC5\u0FC7-\u0FCC\u0FCE\u0FCF\u0FD5-\u0FD8\u109E\u109F\u1390-\u1399\u166D\u17DB\u1940\u19DE-\u19FF\u1B61-\u1B6A\u1B74-\u1B7C\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD\u1FFE\u2044\u2052\u207A-\u207C\u208A-\u208C\u20A0-\u20C0\u2100\u2101\u2103-\u2106\u2108\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A\u213B\u2140-\u2144\u214A-\u214D\u214F\u218A\u218B\u2190-\u2307\u230C-\u2328\u232B-\u2426\u2440-\u244A\u249C-\u24E9\u2500-\u2767\u2794-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2B73\u2B76-\u2B95\u2B97-\u2BFF\u2CE5-\u2CEA\u2E50\u2E51\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u2FFF\u3004\u3012\u3013\u3020\u3036\u3037\u303E\u303F\u309B\u309C\u3190\u3191\u3196-\u319F\u31C0-\u31E3\u31EF\u3200-\u321E\u322A-\u3247\u3250\u3260-\u327F\u328A-\u32B0\u32C0-\u33FF\u4DC0-\u4DFF\uA490-\uA4C6\uA700-\uA716\uA720\uA721\uA789\uA78A\uA828-\uA82B\uA836-\uA839\uAA77-\uAA79\uAB5B\uAB6A\uAB6B\uFB29\uFBB2-\uFBC2\uFD40-\uFD4F\uFDCF\uFDFC-\uFDFF\uFE62\uFE64-\uFE66\uFE69\uFF04\uFF0B\uFF1C-\uFF1E\uFF3E\uFF40\uFF5C\uFF5E\uFFE0-\uFFE6\uFFE8-\uFFEE\uFFFC\uFFFD]|\uD800[\uDD37-\uDD3F\uDD79-\uDD89\uDD8C-\uDD8E\uDD90-\uDD9C\uDDA0\uDDD0-\uDDFC]|\uD802[\uDC77\uDC78\uDEC8]|\uD805\uDF3F|\uD807[\uDFD5-\uDFF1]|\uD81A[\uDF3C-\uDF3F\uDF45]|\uD82F\uDC9C|\uD833[\uDF50-\uDFC3]|\uD834[\uDC00-\uDCF5\uDD00-\uDD26\uDD29-\uDD64\uDD6A-\uDD6C\uDD83\uDD84\uDD8C-\uDDA9\uDDAE-\uDDEA\uDE00-\uDE41\uDE45\uDF00-\uDF56]|\uD835[\uDEC1\uDEDB\uDEFB\uDF15\uDF35\uDF4F\uDF6F\uDF89\uDFA9\uDFC3]|\uD836[\uDC00-\uDDFF\uDE37-\uDE3A\uDE6D-\uDE74\uDE76-\uDE83\uDE85\uDE86]|\uD838[\uDD4F\uDEFF]|\uD83B[\uDCAC\uDCB0\uDD2E\uDEF0\uDEF1]|\uD83C[\uDC00-\uDC2B\uDC30-\uDC93\uDCA0-\uDCAE\uDCB1-\uDCBF\uDCC1-\uDCCF\uDCD1-\uDCF5\uDD0D-\uDDAD\uDDE6-\uDE02\uDE10-\uDE3B\uDE40-\uDE48\uDE50\uDE51\uDE60-\uDE65\uDF00-\uDFFF]|\uD83D[\uDC00-\uDED7\uDEDC-\uDEEC\uDEF0-\uDEFC\uDF00-\uDF76\uDF7B-\uDFD9\uDFE0-\uDFEB\uDFF0]|\uD83E[\uDC00-\uDC0B\uDC10-\uDC47\uDC50-\uDC59\uDC60-\uDC87\uDC90-\uDCAD\uDCB0\uDCB1\uDD00-\uDE53\uDE60-\uDE6D\uDE70-\uDE7C\uDE80-\uDE88\uDE90-\uDEBD\uDEBF-\uDEC5\uDECE-\uDEDB\uDEE0-\uDEE8\uDEF0-\uDEF8\uDF00-\uDF92\uDF94-\uDFCA]/,de=/[ \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/,fe=t({Any:()=>oe,Cc:()=>se,Cf:()=>ce,P:()=>le,S:()=>ue,Z:()=>de}),pe=new Uint16Array(`ᵁ<Õıʊҝջאٵ۞ޢߖࠏ੊ઑඡ๭༉༦჊ረዡᐕᒝᓃᓟᔥ\0\0\0\0\0\0ᕫᛍᦍᰒᷝ὾⁠↰⊍⏀⏻⑂⠤⤒ⴈ⹈⿎〖㊺㘹㞬㣾㨨㩱㫠㬮ࠀEMabcfglmnoprstu\\bfms¦³¹ÈÏlig耻Æ䃆P耻&䀦cute耻Á䃁reve;䄂Āiyx}rc耻Â䃂;䐐r;쀀𝔄rave耻À䃀pha;䎑acr;䄀d;橓Āgp¡on;䄄f;쀀𝔸plyFunction;恡ing耻Å䃅Ācs¾Ãr;쀀𝒜ign;扔ilde耻Ã䃃ml耻Ä䃄ЀaceforsuåûþėĜĢħĪĀcrêòkslash;或Ŷöø;櫧ed;挆y;䐑ƀcrtąċĔause;戵noullis;愬a;䎒r;쀀𝔅pf;쀀𝔹eve;䋘còēmpeq;扎܀HOacdefhilorsuōőŖƀƞƢƵƷƺǜȕɳɸɾcy;䐧PY耻©䂩ƀcpyŝŢźute;䄆Ā;iŧŨ拒talDifferentialD;慅leys;愭ȀaeioƉƎƔƘron;䄌dil耻Ç䃇rc;䄈nint;戰ot;䄊ĀdnƧƭilla;䂸terDot;䂷òſi;䎧rcleȀDMPTǇǋǑǖot;抙inus;抖lus;投imes;抗oĀcsǢǸkwiseContourIntegral;戲eCurlyĀDQȃȏoubleQuote;思uote;怙ȀlnpuȞȨɇɕonĀ;eȥȦ户;橴ƀgitȯȶȺruent;扡nt;戯ourIntegral;戮ĀfrɌɎ;愂oduct;成nterClockwiseContourIntegral;戳oss;樯cr;쀀𝒞pĀ;Cʄʅ拓ap;才րDJSZacefiosʠʬʰʴʸˋ˗ˡ˦̳ҍĀ;oŹʥtrahd;椑cy;䐂cy;䐅cy;䐏ƀgrsʿ˄ˇger;怡r;憡hv;櫤Āayː˕ron;䄎;䐔lĀ;t˝˞戇a;䎔r;쀀𝔇Āaf˫̧Ācm˰̢riticalȀADGT̖̜̀̆cute;䂴oŴ̋̍;䋙bleAcute;䋝rave;䁠ilde;䋜ond;拄ferentialD;慆Ѱ̽\0\0\0͔͂\0Ѕf;쀀𝔻ƀ;DE͈͉͍䂨ot;惜qual;扐blèCDLRUVͣͲ΂ϏϢϸontourIntegraìȹoɴ͹\0\0ͻ»͉nArrow;懓Āeo·ΤftƀARTΐΖΡrrow;懐ightArrow;懔eåˊngĀLRΫτeftĀARγιrrow;柸ightArrow;柺ightArrow;柹ightĀATϘϞrrow;懒ee;抨pɁϩ\0\0ϯrrow;懑ownArrow;懕erticalBar;戥ǹABLRTaВЪаўѿͼrrowƀ;BUНОТ憓ar;椓pArrow;懵reve;䌑eft˒к\0ц\0ѐightVector;楐eeVector;楞ectorĀ;Bљњ憽ar;楖ightǔѧ\0ѱeeVector;楟ectorĀ;BѺѻ懁ar;楗eeĀ;A҆҇护rrow;憧ĀctҒҗr;쀀𝒟rok;䄐ࠀNTacdfglmopqstuxҽӀӄӋӞӢӧӮӵԡԯԶՒ՝ՠեG;䅊H耻Ð䃐cute耻É䃉ƀaiyӒӗӜron;䄚rc耻Ê䃊;䐭ot;䄖r;쀀𝔈rave耻È䃈ement;戈ĀapӺӾcr;䄒tyɓԆ\0\0ԒmallSquare;旻erySmallSquare;斫ĀgpԦԪon;䄘f;쀀𝔼silon;䎕uĀaiԼՉlĀ;TՂՃ橵ilde;扂librium;懌Āci՗՚r;愰m;橳a;䎗ml耻Ë䃋Āipժկsts;戃onentialE;慇ʀcfiosօֈ֍ֲ׌y;䐤r;쀀𝔉lledɓ֗\0\0֣mallSquare;旼erySmallSquare;斪Ͱֺ\0ֿ\0\0ׄf;쀀𝔽All;戀riertrf;愱cò׋؀JTabcdfgorstר׬ׯ׺؀ؒؖ؛؝أ٬ٲcy;䐃耻>䀾mmaĀ;d׷׸䎓;䏜reve;䄞ƀeiy؇،ؐdil;䄢rc;䄜;䐓ot;䄠r;쀀𝔊;拙pf;쀀𝔾eater̀EFGLSTصلَٖٛ٦qualĀ;Lؾؿ扥ess;招ullEqual;执reater;檢ess;扷lantEqual;橾ilde;扳cr;쀀𝒢;扫ЀAacfiosuڅڋږڛڞڪھۊRDcy;䐪Āctڐڔek;䋇;䁞irc;䄤r;愌lbertSpace;愋ǰگ\0ڲf;愍izontalLine;攀Āctۃۅòکrok;䄦mpńېۘownHumðįqual;扏܀EJOacdfgmnostuۺ۾܃܇܎ܚܞܡܨ݄ݸދޏޕcy;䐕lig;䄲cy;䐁cute耻Í䃍Āiyܓܘrc耻Î䃎;䐘ot;䄰r;愑rave耻Ì䃌ƀ;apܠܯܿĀcgܴܷr;䄪inaryI;慈lieóϝǴ݉\0ݢĀ;eݍݎ戬Āgrݓݘral;戫section;拂isibleĀCTݬݲomma;恣imes;恢ƀgptݿރވon;䄮f;쀀𝕀a;䎙cr;愐ilde;䄨ǫޚ\0ޞcy;䐆l耻Ï䃏ʀcfosuެ޷޼߂ߐĀiyޱ޵rc;䄴;䐙r;쀀𝔍pf;쀀𝕁ǣ߇\0ߌr;쀀𝒥rcy;䐈kcy;䐄΀HJacfosߤߨ߽߬߱ࠂࠈcy;䐥cy;䐌ppa;䎚Āey߶߻dil;䄶;䐚r;쀀𝔎pf;쀀𝕂cr;쀀𝒦րJTaceflmostࠥࠩࠬࡐࡣ঳সে্਷ੇcy;䐉耻<䀼ʀcmnpr࠷࠼ࡁࡄࡍute;䄹bda;䎛g;柪lacetrf;愒r;憞ƀaeyࡗ࡜ࡡron;䄽dil;䄻;䐛Āfsࡨ॰tԀACDFRTUVarࡾࢩࢱࣦ࣠ࣼयज़ΐ४Ānrࢃ࢏gleBracket;柨rowƀ;BR࢙࢚࢞憐ar;懤ightArrow;懆eiling;挈oǵࢷ\0ࣃbleBracket;柦nǔࣈ\0࣒eeVector;楡ectorĀ;Bࣛࣜ懃ar;楙loor;挊ightĀAV࣯ࣵrrow;憔ector;楎Āerँगeƀ;AVउऊऐ抣rrow;憤ector;楚iangleƀ;BEतथऩ抲ar;槏qual;抴pƀDTVषूौownVector;楑eeVector;楠ectorĀ;Bॖॗ憿ar;楘ectorĀ;B॥०憼ar;楒ightáΜs̀EFGLSTॾঋকঝঢভqualGreater;拚ullEqual;扦reater;扶ess;檡lantEqual;橽ilde;扲r;쀀𝔏Ā;eঽা拘ftarrow;懚idot;䄿ƀnpw৔ਖਛgȀLRlr৞৷ਂਐeftĀAR০৬rrow;柵ightArrow;柷ightArrow;柶eftĀarγਊightáοightáϊf;쀀𝕃erĀLRਢਬeftArrow;憙ightArrow;憘ƀchtਾੀੂòࡌ;憰rok;䅁;扪Ѐacefiosuਗ਼੝੠੷੼અઋ઎p;椅y;䐜Ādl੥੯iumSpace;恟lintrf;愳r;쀀𝔐nusPlus;戓pf;쀀𝕄cò੶;䎜ҀJacefostuણધભીଔଙඑ඗ඞcy;䐊cute;䅃ƀaey઴હાron;䅇dil;䅅;䐝ƀgswે૰଎ativeƀMTV૓૟૨ediumSpace;怋hiĀcn૦૘ë૙eryThiî૙tedĀGL૸ଆreaterGreateòٳessLesóੈLine;䀊r;쀀𝔑ȀBnptଢନଷ଺reak;恠BreakingSpace;䂠f;愕ڀ;CDEGHLNPRSTV୕ୖ୪୼஡௫ఄ౞಄ದ೘ൡඅ櫬Āou୛୤ngruent;扢pCap;扭oubleVerticalBar;戦ƀlqxஃஊ஛ement;戉ualĀ;Tஒஓ扠ilde;쀀≂̸ists;戄reater΀;EFGLSTஶஷ஽௉௓௘௥扯qual;扱ullEqual;쀀≧̸reater;쀀≫̸ess;批lantEqual;쀀⩾̸ilde;扵umpń௲௽ownHump;쀀≎̸qual;쀀≏̸eĀfsఊధtTriangleƀ;BEచఛడ拪ar;쀀⧏̸qual;括s̀;EGLSTవశ఼ౄోౘ扮qual;扰reater;扸ess;쀀≪̸lantEqual;쀀⩽̸ilde;扴estedĀGL౨౹reaterGreater;쀀⪢̸essLess;쀀⪡̸recedesƀ;ESಒಓಛ技qual;쀀⪯̸lantEqual;拠ĀeiಫಹverseElement;戌ghtTriangleƀ;BEೋೌ೒拫ar;쀀⧐̸qual;拭ĀquೝഌuareSuĀbp೨೹setĀ;E೰ೳ쀀⊏̸qual;拢ersetĀ;Eഃആ쀀⊐̸qual;拣ƀbcpഓതൎsetĀ;Eഛഞ쀀⊂⃒qual;抈ceedsȀ;ESTലള഻െ抁qual;쀀⪰̸lantEqual;拡ilde;쀀≿̸ersetĀ;E൘൛쀀⊃⃒qual;抉ildeȀ;EFT൮൯൵ൿ扁qual;扄ullEqual;扇ilde;扉erticalBar;戤cr;쀀𝒩ilde耻Ñ䃑;䎝܀Eacdfgmoprstuvලෂ෉෕ෛ෠෧෼ขภยา฿ไlig;䅒cute耻Ó䃓Āiy෎ීrc耻Ô䃔;䐞blac;䅐r;쀀𝔒rave耻Ò䃒ƀaei෮ෲ෶cr;䅌ga;䎩cron;䎟pf;쀀𝕆enCurlyĀDQฎบoubleQuote;怜uote;怘;橔Āclวฬr;쀀𝒪ash耻Ø䃘iŬื฼de耻Õ䃕es;樷ml耻Ö䃖erĀBP๋๠Āar๐๓r;怾acĀek๚๜;揞et;掴arenthesis;揜Ҁacfhilors๿ງຊຏຒດຝະ໼rtialD;戂y;䐟r;쀀𝔓i;䎦;䎠usMinus;䂱Āipຢອncareplanåڝf;愙Ȁ;eio຺ູ໠໤檻cedesȀ;EST່້໏໚扺qual;檯lantEqual;扼ilde;找me;怳Ādp໩໮uct;戏ortionĀ;aȥ໹l;戝Āci༁༆r;쀀𝒫;䎨ȀUfos༑༖༛༟OT耻"䀢r;쀀𝔔pf;愚cr;쀀𝒬؀BEacefhiorsu༾གྷཇའཱིྦྷྪྭ႖ႩႴႾarr;椐G耻®䂮ƀcnrཎནབute;䅔g;柫rĀ;tཛྷཝ憠l;椖ƀaeyཧཬཱron;䅘dil;䅖;䐠Ā;vླྀཹ愜erseĀEUྂྙĀlq྇ྎement;戋uilibrium;懋pEquilibrium;楯r»ཹo;䎡ghtЀACDFTUVa࿁࿫࿳ဢဨၛႇϘĀnr࿆࿒gleBracket;柩rowƀ;BL࿜࿝࿡憒ar;懥eftArrow;懄eiling;按oǵ࿹\0စbleBracket;柧nǔည\0နeeVector;楝ectorĀ;Bဝသ懂ar;楕loor;挋Āerိ၃eƀ;AVဵံြ抢rrow;憦ector;楛iangleƀ;BEၐၑၕ抳ar;槐qual;抵pƀDTVၣၮၸownVector;楏eeVector;楜ectorĀ;Bႂႃ憾ar;楔ectorĀ;B႑႒懀ar;楓Āpuႛ႞f;愝ndImplies;楰ightarrow;懛ĀchႹႼr;愛;憱leDelayed;槴ڀHOacfhimoqstuფჱჷჽᄙᄞᅑᅖᅡᅧᆵᆻᆿĀCcჩხHcy;䐩y;䐨FTcy;䐬cute;䅚ʀ;aeiyᄈᄉᄎᄓᄗ檼ron;䅠dil;䅞rc;䅜;䐡r;쀀𝔖ortȀDLRUᄪᄴᄾᅉownArrow»ОeftArrow»࢚ightArrow»࿝pArrow;憑gma;䎣allCircle;战pf;쀀𝕊ɲᅭ\0\0ᅰt;戚areȀ;ISUᅻᅼᆉᆯ斡ntersection;抓uĀbpᆏᆞsetĀ;Eᆗᆘ抏qual;抑ersetĀ;Eᆨᆩ抐qual;抒nion;抔cr;쀀𝒮ar;拆ȀbcmpᇈᇛሉላĀ;sᇍᇎ拐etĀ;Eᇍᇕqual;抆ĀchᇠህeedsȀ;ESTᇭᇮᇴᇿ扻qual;檰lantEqual;扽ilde;承Tháྌ;我ƀ;esሒሓሣ拑rsetĀ;Eሜም抃qual;抇et»ሓրHRSacfhiorsሾቄ቉ቕ቞ቱቶኟዂወዑORN耻Þ䃞ADE;愢ĀHc቎ቒcy;䐋y;䐦Ābuቚቜ;䀉;䎤ƀaeyብቪቯron;䅤dil;䅢;䐢r;쀀𝔗Āeiቻ኉ǲኀ\0ኇefore;戴a;䎘Ācn኎ኘkSpace;쀀  Space;怉ldeȀ;EFTካኬኲኼ戼qual;扃ullEqual;扅ilde;扈pf;쀀𝕋ipleDot;惛Āctዖዛr;쀀𝒯rok;䅦ૡዷጎጚጦ\0ጬጱ\0\0\0\0\0ጸጽ፷ᎅ\0᏿ᐄᐊᐐĀcrዻጁute耻Ú䃚rĀ;oጇገ憟cir;楉rǣጓ\0጖y;䐎ve;䅬Āiyጞጣrc耻Û䃛;䐣blac;䅰r;쀀𝔘rave耻Ù䃙acr;䅪Ādiፁ፩erĀBPፈ፝Āarፍፐr;䁟acĀekፗፙ;揟et;掵arenthesis;揝onĀ;P፰፱拃lus;抎Āgp፻፿on;䅲f;쀀𝕌ЀADETadps᎕ᎮᎸᏄϨᏒᏗᏳrrowƀ;BDᅐᎠᎤar;椒ownArrow;懅ownArrow;憕quilibrium;楮eeĀ;AᏋᏌ报rrow;憥ownáϳerĀLRᏞᏨeftArrow;憖ightArrow;憗iĀ;lᏹᏺ䏒on;䎥ing;䅮cr;쀀𝒰ilde;䅨ml耻Ü䃜ҀDbcdefosvᐧᐬᐰᐳᐾᒅᒊᒐᒖash;披ar;櫫y;䐒ashĀ;lᐻᐼ抩;櫦Āerᑃᑅ;拁ƀbtyᑌᑐᑺar;怖Ā;iᑏᑕcalȀBLSTᑡᑥᑪᑴar;戣ine;䁼eparator;杘ilde;所ThinSpace;怊r;쀀𝔙pf;쀀𝕍cr;쀀𝒱dash;抪ʀcefosᒧᒬᒱᒶᒼirc;䅴dge;拀r;쀀𝔚pf;쀀𝕎cr;쀀𝒲Ȁfiosᓋᓐᓒᓘr;쀀𝔛;䎞pf;쀀𝕏cr;쀀𝒳ҀAIUacfosuᓱᓵᓹᓽᔄᔏᔔᔚᔠcy;䐯cy;䐇cy;䐮cute耻Ý䃝Āiyᔉᔍrc;䅶;䐫r;쀀𝔜pf;쀀𝕐cr;쀀𝒴ml;䅸ЀHacdefosᔵᔹᔿᕋᕏᕝᕠᕤcy;䐖cute;䅹Āayᕄᕉron;䅽;䐗ot;䅻ǲᕔ\0ᕛoWidtè૙a;䎖r;愨pf;愤cr;쀀𝒵௡ᖃᖊᖐ\0ᖰᖶᖿ\0\0\0\0ᗆᗛᗫᙟ᙭\0ᚕ᚛ᚲᚹ\0ᚾcute耻á䃡reve;䄃̀;Ediuyᖜᖝᖡᖣᖨᖭ戾;쀀∾̳;房rc耻â䃢te肻´̆;䐰lig耻æ䃦Ā;r²ᖺ;쀀𝔞rave耻à䃠ĀepᗊᗖĀfpᗏᗔsym;愵èᗓha;䎱ĀapᗟcĀclᗤᗧr;䄁g;樿ɤᗰ\0\0ᘊʀ;adsvᗺᗻᗿᘁᘇ戧nd;橕;橜lope;橘;橚΀;elmrszᘘᘙᘛᘞᘿᙏᙙ戠;榤e»ᘙsdĀ;aᘥᘦ戡ѡᘰᘲᘴᘶᘸᘺᘼᘾ;榨;榩;榪;榫;榬;榭;榮;榯tĀ;vᙅᙆ戟bĀ;dᙌᙍ抾;榝Āptᙔᙗh;戢»¹arr;捼Āgpᙣᙧon;䄅f;쀀𝕒΀;Eaeiop዁ᙻᙽᚂᚄᚇᚊ;橰cir;橯;扊d;手s;䀧roxĀ;e዁ᚒñᚃing耻å䃥ƀctyᚡᚦᚨr;쀀𝒶;䀪mpĀ;e዁ᚯñʈilde耻ã䃣ml耻ä䃤Āciᛂᛈoninôɲnt;樑ࠀNabcdefiklnoprsu᛭ᛱᜰ᜼ᝃᝈ᝸᝽០៦ᠹᡐᜍ᤽᥈ᥰot;櫭Ācrᛶ᜞kȀcepsᜀᜅᜍᜓong;扌psilon;䏶rime;怵imĀ;e᜚᜛戽q;拍Ŷᜢᜦee;抽edĀ;gᜬᜭ挅e»ᜭrkĀ;t፜᜷brk;掶Āoyᜁᝁ;䐱quo;怞ʀcmprtᝓ᝛ᝡᝤᝨausĀ;eĊĉptyv;榰séᜌnoõēƀahwᝯ᝱ᝳ;䎲;愶een;扬r;쀀𝔟g΀costuvwឍឝឳេ៕៛៞ƀaiuបពរðݠrc;旯p»፱ƀdptឤឨឭot;樀lus;樁imes;樂ɱឹ\0\0ើcup;樆ar;昅riangleĀdu៍្own;施p;斳plus;樄eåᑄåᒭarow;植ƀako៭ᠦᠵĀcn៲ᠣkƀlst៺֫᠂ozenge;槫riangleȀ;dlr᠒᠓᠘᠝斴own;斾eft;旂ight;斸k;搣Ʊᠫ\0ᠳƲᠯ\0ᠱ;斒;斑4;斓ck;斈ĀeoᠾᡍĀ;qᡃᡆ쀀=⃥uiv;쀀≡⃥t;挐Ȁptwxᡙᡞᡧᡬf;쀀𝕓Ā;tᏋᡣom»Ꮜtie;拈؀DHUVbdhmptuvᢅᢖᢪᢻᣗᣛᣬ᣿ᤅᤊᤐᤡȀLRlrᢎᢐᢒᢔ;敗;敔;敖;敓ʀ;DUduᢡᢢᢤᢦᢨ敐;敦;敩;敤;敧ȀLRlrᢳᢵᢷᢹ;敝;敚;敜;教΀;HLRhlrᣊᣋᣍᣏᣑᣓᣕ救;敬;散;敠;敫;敢;敟ox;槉ȀLRlrᣤᣦᣨᣪ;敕;敒;攐;攌ʀ;DUduڽ᣷᣹᣻᣽;敥;敨;攬;攴inus;抟lus;択imes;抠ȀLRlrᤙᤛᤝ᤟;敛;敘;攘;攔΀;HLRhlrᤰᤱᤳᤵᤷ᤻᤹攂;敪;敡;敞;攼;攤;攜Āevģ᥂bar耻¦䂦Ȁceioᥑᥖᥚᥠr;쀀𝒷mi;恏mĀ;e᜚᜜lƀ;bhᥨᥩᥫ䁜;槅sub;柈Ŭᥴ᥾lĀ;e᥹᥺怢t»᥺pƀ;Eeįᦅᦇ;檮Ā;qۜۛೡᦧ\0᧨ᨑᨕᨲ\0ᨷᩐ\0\0᪴\0\0᫁\0\0ᬡᬮ᭍᭒\0᯽\0ᰌƀcpr᦭ᦲ᧝ute;䄇̀;abcdsᦿᧀᧄ᧊᧕᧙戩nd;橄rcup;橉Āau᧏᧒p;橋p;橇ot;橀;쀀∩︀Āeo᧢᧥t;恁îړȀaeiu᧰᧻ᨁᨅǰ᧵\0᧸s;橍on;䄍dil耻ç䃧rc;䄉psĀ;sᨌᨍ橌m;橐ot;䄋ƀdmnᨛᨠᨦil肻¸ƭptyv;榲t脀¢;eᨭᨮ䂢räƲr;쀀𝔠ƀceiᨽᩀᩍy;䑇ckĀ;mᩇᩈ朓ark»ᩈ;䏇r΀;Ecefms᩟᩠ᩢᩫ᪤᪪᪮旋;槃ƀ;elᩩᩪᩭ䋆q;扗eɡᩴ\0\0᪈rrowĀlr᩼᪁eft;憺ight;憻ʀRSacd᪒᪔᪖᪚᪟»ཇ;擈st;抛irc;抚ash;抝nint;樐id;櫯cir;槂ubsĀ;u᪻᪼晣it»᪼ˬ᫇᫔᫺\0ᬊonĀ;eᫍᫎ䀺Ā;qÇÆɭ᫙\0\0᫢aĀ;t᫞᫟䀬;䁀ƀ;fl᫨᫩᫫戁îᅠeĀmx᫱᫶ent»᫩eóɍǧ᫾\0ᬇĀ;dኻᬂot;橭nôɆƀfryᬐᬔᬗ;쀀𝕔oäɔ脀©;sŕᬝr;愗Āaoᬥᬩrr;憵ss;朗Ācuᬲᬷr;쀀𝒸Ābpᬼ᭄Ā;eᭁᭂ櫏;櫑Ā;eᭉᭊ櫐;櫒dot;拯΀delprvw᭠᭬᭷ᮂᮬᯔ᯹arrĀlr᭨᭪;椸;椵ɰ᭲\0\0᭵r;拞c;拟arrĀ;p᭿ᮀ憶;椽̀;bcdosᮏᮐᮖᮡᮥᮨ截rcap;橈Āauᮛᮞp;橆p;橊ot;抍r;橅;쀀∪︀Ȁalrv᮵ᮿᯞᯣrrĀ;mᮼᮽ憷;椼yƀevwᯇᯔᯘqɰᯎ\0\0ᯒreã᭳uã᭵ee;拎edge;拏en耻¤䂤earrowĀlrᯮ᯳eft»ᮀight»ᮽeäᯝĀciᰁᰇoninôǷnt;戱lcty;挭ঀAHabcdefhijlorstuwz᰸᰻᰿ᱝᱩᱵᲊᲞᲬᲷ᳻᳿ᴍᵻᶑᶫᶻ᷆᷍rò΁ar;楥Ȁglrs᱈ᱍ᱒᱔ger;怠eth;愸òᄳhĀ;vᱚᱛ怐»ऊūᱡᱧarow;椏aã̕Āayᱮᱳron;䄏;䐴ƀ;ao̲ᱼᲄĀgrʿᲁr;懊tseq;橷ƀglmᲑᲔᲘ耻°䂰ta;䎴ptyv;榱ĀirᲣᲨsht;楿;쀀𝔡arĀlrᲳᲵ»ࣜ»သʀaegsv᳂͸᳖᳜᳠mƀ;oș᳊᳔ndĀ;ș᳑uit;晦amma;䏝in;拲ƀ;io᳧᳨᳸䃷de脀÷;o᳧ᳰntimes;拇nø᳷cy;䑒cɯᴆ\0\0ᴊrn;挞op;挍ʀlptuwᴘᴝᴢᵉᵕlar;䀤f;쀀𝕕ʀ;emps̋ᴭᴷᴽᵂqĀ;d͒ᴳot;扑inus;戸lus;戔quare;抡blebarwedgåúnƀadhᄮᵝᵧownarrowóᲃarpoonĀlrᵲᵶefôᲴighôᲶŢᵿᶅkaro÷གɯᶊ\0\0ᶎrn;挟op;挌ƀcotᶘᶣᶦĀryᶝᶡ;쀀𝒹;䑕l;槶rok;䄑Ādrᶰᶴot;拱iĀ;fᶺ᠖斿Āah᷀᷃ròЩaòྦangle;榦Āci᷒ᷕy;䑟grarr;柿ऀDacdefglmnopqrstuxḁḉḙḸոḼṉṡṾấắẽỡἪἷὄ὎὚ĀDoḆᴴoôᲉĀcsḎḔute耻é䃩ter;橮ȀaioyḢḧḱḶron;䄛rĀ;cḭḮ扖耻ê䃪lon;払;䑍ot;䄗ĀDrṁṅot;扒;쀀𝔢ƀ;rsṐṑṗ檚ave耻è䃨Ā;dṜṝ檖ot;檘Ȁ;ilsṪṫṲṴ檙nters;揧;愓Ā;dṹṺ檕ot;檗ƀapsẅẉẗcr;䄓tyƀ;svẒẓẕ戅et»ẓpĀ1;ẝẤĳạả;怄;怅怃ĀgsẪẬ;䅋p;怂ĀgpẴẸon;䄙f;쀀𝕖ƀalsỄỎỒrĀ;sỊị拕l;槣us;橱iƀ;lvỚớở䎵on»ớ;䏵ȀcsuvỪỳἋἣĀioữḱrc»Ḯɩỹ\0\0ỻíՈantĀglἂἆtr»ṝess»Ṻƀaeiἒ἖Ἒls;䀽st;扟vĀ;DȵἠD;橸parsl;槥ĀDaἯἳot;打rr;楱ƀcdiἾὁỸr;愯oô͒ĀahὉὋ;䎷耻ð䃰Āmrὓὗl耻ë䃫o;悬ƀcipὡὤὧl;䀡sôծĀeoὬὴctatioîՙnentialåչৡᾒ\0ᾞ\0ᾡᾧ\0\0ῆῌ\0ΐ\0ῦῪ \0 ⁚llingdotseñṄy;䑄male;晀ƀilrᾭᾳ῁lig;耀ﬃɩᾹ\0\0᾽g;耀ﬀig;耀ﬄ;쀀𝔣lig;耀ﬁlig;쀀fjƀaltῙ῜ῡt;晭ig;耀ﬂns;斱of;䆒ǰ΅\0ῳf;쀀𝕗ĀakֿῷĀ;vῼ´拔;櫙artint;樍Āao‌⁕Ācs‑⁒α‚‰‸⁅⁈\0⁐β•‥‧‪‬\0‮耻½䂽;慓耻¼䂼;慕;慙;慛Ƴ‴\0‶;慔;慖ʴ‾⁁\0\0⁃耻¾䂾;慗;慜5;慘ƶ⁌\0⁎;慚;慝8;慞l;恄wn;挢cr;쀀𝒻ࢀEabcdefgijlnorstv₂₉₟₥₰₴⃰⃵⃺⃿℃ℒℸ̗ℾ⅒↞Ā;lٍ₇;檌ƀcmpₐₕ₝ute;䇵maĀ;dₜ᳚䎳;檆reve;䄟Āiy₪₮rc;䄝;䐳ot;䄡Ȁ;lqsؾق₽⃉ƀ;qsؾٌ⃄lanô٥Ȁ;cdl٥⃒⃥⃕c;檩otĀ;o⃜⃝檀Ā;l⃢⃣檂;檄Ā;e⃪⃭쀀⋛︀s;檔r;쀀𝔤Ā;gٳ؛mel;愷cy;䑓Ȁ;Eajٚℌℎℐ;檒;檥;檤ȀEaesℛℝ℩ℴ;扩pĀ;p℣ℤ檊rox»ℤĀ;q℮ℯ檈Ā;q℮ℛim;拧pf;쀀𝕘Āci⅃ⅆr;愊mƀ;el٫ⅎ⅐;檎;檐茀>;cdlqr׮ⅠⅪⅮⅳⅹĀciⅥⅧ;檧r;橺ot;拗Par;榕uest;橼ʀadelsↄⅪ←ٖ↛ǰ↉\0↎proø₞r;楸qĀlqؿ↖lesó₈ií٫Āen↣↭rtneqq;쀀≩︀Å↪ԀAabcefkosy⇄⇇⇱⇵⇺∘∝∯≨≽ròΠȀilmr⇐⇔⇗⇛rsðᒄf»․ilôکĀdr⇠⇤cy;䑊ƀ;cwࣴ⇫⇯ir;楈;憭ar;意irc;䄥ƀalr∁∎∓rtsĀ;u∉∊晥it»∊lip;怦con;抹r;쀀𝔥sĀew∣∩arow;椥arow;椦ʀamopr∺∾≃≞≣rr;懿tht;戻kĀlr≉≓eftarrow;憩ightarrow;憪f;쀀𝕙bar;怕ƀclt≯≴≸r;쀀𝒽asè⇴rok;䄧Ābp⊂⊇ull;恃hen»ᱛૡ⊣\0⊪\0⊸⋅⋎\0⋕⋳\0\0⋸⌢⍧⍢⍿\0⎆⎪⎴cute耻í䃭ƀ;iyݱ⊰⊵rc耻î䃮;䐸Ācx⊼⊿y;䐵cl耻¡䂡ĀfrΟ⋉;쀀𝔦rave耻ì䃬Ȁ;inoܾ⋝⋩⋮Āin⋢⋦nt;樌t;戭fin;槜ta;愩lig;䄳ƀaop⋾⌚⌝ƀcgt⌅⌈⌗r;䄫ƀelpܟ⌏⌓inåގarôܠh;䄱f;抷ed;䆵ʀ;cfotӴ⌬⌱⌽⍁are;愅inĀ;t⌸⌹戞ie;槝doô⌙ʀ;celpݗ⍌⍐⍛⍡al;抺Āgr⍕⍙eróᕣã⍍arhk;樗rod;樼Ȁcgpt⍯⍲⍶⍻y;䑑on;䄯f;쀀𝕚a;䎹uest耻¿䂿Āci⎊⎏r;쀀𝒾nʀ;EdsvӴ⎛⎝⎡ӳ;拹ot;拵Ā;v⎦⎧拴;拳Ā;iݷ⎮lde;䄩ǫ⎸\0⎼cy;䑖l耻ï䃯̀cfmosu⏌⏗⏜⏡⏧⏵Āiy⏑⏕rc;䄵;䐹r;쀀𝔧ath;䈷pf;쀀𝕛ǣ⏬\0⏱r;쀀𝒿rcy;䑘kcy;䑔Ѐacfghjos␋␖␢␧␭␱␵␻ppaĀ;v␓␔䎺;䏰Āey␛␠dil;䄷;䐺r;쀀𝔨reen;䄸cy;䑅cy;䑜pf;쀀𝕜cr;쀀𝓀஀ABEHabcdefghjlmnoprstuv⑰⒁⒆⒍⒑┎┽╚▀♎♞♥♹♽⚚⚲⛘❝❨➋⟀⠁⠒ƀart⑷⑺⑼rò৆òΕail;椛arr;椎Ā;gঔ⒋;檋ar;楢ॣ⒥\0⒪\0⒱\0\0\0\0\0⒵Ⓔ\0ⓆⓈⓍ\0⓹ute;䄺mptyv;榴raîࡌbda;䎻gƀ;dlࢎⓁⓃ;榑åࢎ;檅uo耻«䂫rЀ;bfhlpst࢙ⓞⓦⓩ⓫⓮⓱⓵Ā;f࢝ⓣs;椟s;椝ë≒p;憫l;椹im;楳l;憢ƀ;ae⓿─┄檫il;椙Ā;s┉┊檭;쀀⪭︀ƀabr┕┙┝rr;椌rk;杲Āak┢┬cĀek┨┪;䁻;䁛Āes┱┳;榋lĀdu┹┻;榏;榍Ȁaeuy╆╋╖╘ron;䄾Ādi═╔il;䄼ìࢰâ┩;䐻Ȁcqrs╣╦╭╽a;椶uoĀ;rนᝆĀdu╲╷har;楧shar;楋h;憲ʀ;fgqs▋▌উ◳◿扤tʀahlrt▘▤▷◂◨rrowĀ;t࢙□aé⓶arpoonĀdu▯▴own»њp»०eftarrows;懇ightƀahs◍◖◞rrowĀ;sࣴࢧarpoonó྘quigarro÷⇰hreetimes;拋ƀ;qs▋ও◺lanôবʀ;cdgsব☊☍☝☨c;檨otĀ;o☔☕橿Ā;r☚☛檁;檃Ā;e☢☥쀀⋚︀s;檓ʀadegs☳☹☽♉♋pproøⓆot;拖qĀgq♃♅ôউgtò⒌ôছiíলƀilr♕࣡♚sht;楼;쀀𝔩Ā;Eজ♣;檑š♩♶rĀdu▲♮Ā;l॥♳;楪lk;斄cy;䑙ʀ;achtੈ⚈⚋⚑⚖rò◁orneòᴈard;楫ri;旺Āio⚟⚤dot;䅀ustĀ;a⚬⚭掰che»⚭ȀEaes⚻⚽⛉⛔;扨pĀ;p⛃⛄檉rox»⛄Ā;q⛎⛏檇Ā;q⛎⚻im;拦Ѐabnoptwz⛩⛴⛷✚✯❁❇❐Ānr⛮⛱g;柬r;懽rëࣁgƀlmr⛿✍✔eftĀar০✇ightá৲apsto;柼ightá৽parrowĀlr✥✩efô⓭ight;憬ƀafl✶✹✽r;榅;쀀𝕝us;樭imes;樴š❋❏st;戗áፎƀ;ef❗❘᠀旊nge»❘arĀ;l❤❥䀨t;榓ʀachmt❳❶❼➅➇ròࢨorneòᶌarĀ;d྘➃;業;怎ri;抿̀achiqt➘➝ੀ➢➮➻quo;怹r;쀀𝓁mƀ;egল➪➬;檍;檏Ābu┪➳oĀ;rฟ➹;怚rok;䅂萀<;cdhilqrࠫ⟒☹⟜⟠⟥⟪⟰Āci⟗⟙;檦r;橹reå◲mes;拉arr;楶uest;橻ĀPi⟵⟹ar;榖ƀ;ef⠀भ᠛旃rĀdu⠇⠍shar;楊har;楦Āen⠗⠡rtneqq;쀀≨︀Å⠞܀Dacdefhilnopsu⡀⡅⢂⢎⢓⢠⢥⢨⣚⣢⣤ઃ⣳⤂Dot;戺Ȁclpr⡎⡒⡣⡽r耻¯䂯Āet⡗⡙;時Ā;e⡞⡟朠se»⡟Ā;sျ⡨toȀ;dluျ⡳⡷⡻owîҌefôएðᏑker;斮Āoy⢇⢌mma;権;䐼ash;怔asuredangle»ᘦr;쀀𝔪o;愧ƀcdn⢯⢴⣉ro耻µ䂵Ȁ;acdᑤ⢽⣀⣄sôᚧir;櫰ot肻·Ƶusƀ;bd⣒ᤃ⣓戒Ā;uᴼ⣘;横ţ⣞⣡p;櫛ò−ðઁĀdp⣩⣮els;抧f;쀀𝕞Āct⣸⣽r;쀀𝓂pos»ᖝƀ;lm⤉⤊⤍䎼timap;抸ఀGLRVabcdefghijlmoprstuvw⥂⥓⥾⦉⦘⧚⧩⨕⨚⩘⩝⪃⪕⪤⪨⬄⬇⭄⭿⮮ⰴⱧⱼ⳩Āgt⥇⥋;쀀⋙̸Ā;v⥐௏쀀≫⃒ƀelt⥚⥲⥶ftĀar⥡⥧rrow;懍ightarrow;懎;쀀⋘̸Ā;v⥻ే쀀≪⃒ightarrow;懏ĀDd⦎⦓ash;抯ash;抮ʀbcnpt⦣⦧⦬⦱⧌la»˞ute;䅄g;쀀∠⃒ʀ;Eiop඄⦼⧀⧅⧈;쀀⩰̸d;쀀≋̸s;䅉roø඄urĀ;a⧓⧔普lĀ;s⧓ସǳ⧟\0⧣p肻\xA0ଷmpĀ;e௹ఀʀaeouy⧴⧾⨃⨐⨓ǰ⧹\0⧻;橃on;䅈dil;䅆ngĀ;dൾ⨊ot;쀀⩭̸p;橂;䐽ash;怓΀;Aadqsxஒ⨩⨭⨻⩁⩅⩐rr;懗rĀhr⨳⨶k;椤Ā;oᏲᏰot;쀀≐̸uiöୣĀei⩊⩎ar;椨í஘istĀ;s஠டr;쀀𝔫ȀEest௅⩦⩹⩼ƀ;qs஼⩭௡ƀ;qs஼௅⩴lanô௢ií௪Ā;rஶ⪁»ஷƀAap⪊⪍⪑rò⥱rr;憮ar;櫲ƀ;svྍ⪜ྌĀ;d⪡⪢拼;拺cy;䑚΀AEadest⪷⪺⪾⫂⫅⫶⫹rò⥦;쀀≦̸rr;憚r;急Ȁ;fqs఻⫎⫣⫯tĀar⫔⫙rro÷⫁ightarro÷⪐ƀ;qs఻⪺⫪lanôౕĀ;sౕ⫴»శiíౝĀ;rవ⫾iĀ;eచథiäඐĀpt⬌⬑f;쀀𝕟膀¬;in⬙⬚⬶䂬nȀ;Edvஉ⬤⬨⬮;쀀⋹̸ot;쀀⋵̸ǡஉ⬳⬵;拷;拶iĀ;vಸ⬼ǡಸ⭁⭃;拾;拽ƀaor⭋⭣⭩rȀ;ast୻⭕⭚⭟lleì୻l;쀀⫽⃥;쀀∂̸lint;樔ƀ;ceಒ⭰⭳uåಥĀ;cಘ⭸Ā;eಒ⭽ñಘȀAait⮈⮋⮝⮧rò⦈rrƀ;cw⮔⮕⮙憛;쀀⤳̸;쀀↝̸ghtarrow»⮕riĀ;eೋೖ΀chimpqu⮽⯍⯙⬄୸⯤⯯Ȁ;cerല⯆ഷ⯉uå൅;쀀𝓃ortɭ⬅\0\0⯖ará⭖mĀ;e൮⯟Ā;q൴൳suĀbp⯫⯭å೸åഋƀbcp⯶ⰑⰙȀ;Ees⯿ⰀഢⰄ抄;쀀⫅̸etĀ;eഛⰋqĀ;qണⰀcĀ;eലⰗñസȀ;EesⰢⰣൟⰧ抅;쀀⫆̸etĀ;e൘ⰮqĀ;qൠⰣȀgilrⰽⰿⱅⱇìௗlde耻ñ䃱çృiangleĀlrⱒⱜeftĀ;eచⱚñదightĀ;eೋⱥñ೗Ā;mⱬⱭ䎽ƀ;esⱴⱵⱹ䀣ro;愖p;怇ҀDHadgilrsⲏⲔⲙⲞⲣⲰⲶⳓⳣash;抭arr;椄p;쀀≍⃒ash;抬ĀetⲨⲬ;쀀≥⃒;쀀>⃒nfin;槞ƀAetⲽⳁⳅrr;椂;쀀≤⃒Ā;rⳊⳍ쀀<⃒ie;쀀⊴⃒ĀAtⳘⳜrr;椃rie;쀀⊵⃒im;쀀∼⃒ƀAan⳰⳴ⴂrr;懖rĀhr⳺⳽k;椣Ā;oᏧᏥear;椧ቓ᪕\0\0\0\0\0\0\0\0\0\0\0\0\0ⴭ\0ⴸⵈⵠⵥ⵲ⶄᬇ\0\0ⶍⶫ\0ⷈⷎ\0ⷜ⸙⸫⸾⹃Ācsⴱ᪗ute耻ó䃳ĀiyⴼⵅrĀ;c᪞ⵂ耻ô䃴;䐾ʀabios᪠ⵒⵗǈⵚlac;䅑v;樸old;榼lig;䅓Ācr⵩⵭ir;榿;쀀𝔬ͯ⵹\0\0⵼\0ⶂn;䋛ave耻ò䃲;槁Ābmⶈ෴ar;榵Ȁacitⶕ⶘ⶥⶨrò᪀Āir⶝ⶠr;榾oss;榻nå๒;槀ƀaeiⶱⶵⶹcr;䅍ga;䏉ƀcdnⷀⷅǍron;䎿;榶pf;쀀𝕠ƀaelⷔ⷗ǒr;榷rp;榹΀;adiosvⷪⷫⷮ⸈⸍⸐⸖戨rò᪆Ȁ;efmⷷⷸ⸂⸅橝rĀ;oⷾⷿ愴f»ⷿ耻ª䂪耻º䂺gof;抶r;橖lope;橗;橛ƀclo⸟⸡⸧ò⸁ash耻ø䃸l;折iŬⸯ⸴de耻õ䃵esĀ;aǛ⸺s;樶ml耻ö䃶bar;挽ૡ⹞\0⹽\0⺀⺝\0⺢⺹\0\0⻋ຜ\0⼓\0\0⼫⾼\0⿈rȀ;astЃ⹧⹲຅脀¶;l⹭⹮䂶leìЃɩ⹸\0\0⹻m;櫳;櫽y;䐿rʀcimpt⺋⺏⺓ᡥ⺗nt;䀥od;䀮il;怰enk;怱r;쀀𝔭ƀimo⺨⺰⺴Ā;v⺭⺮䏆;䏕maô੶ne;明ƀ;tv⺿⻀⻈䏀chfork»´;䏖Āau⻏⻟nĀck⻕⻝kĀ;h⇴⻛;愎ö⇴sҀ;abcdemst⻳⻴ᤈ⻹⻽⼄⼆⼊⼎䀫cir;樣ir;樢Āouᵀ⼂;樥;橲n肻±ຝim;樦wo;樧ƀipu⼙⼠⼥ntint;樕f;쀀𝕡nd耻£䂣Ԁ;Eaceinosu່⼿⽁⽄⽇⾁⾉⾒⽾⾶;檳p;檷uå໙Ā;c໎⽌̀;acens່⽙⽟⽦⽨⽾pproø⽃urlyeñ໙ñ໎ƀaes⽯⽶⽺pprox;檹qq;檵im;拨iíໟmeĀ;s⾈ຮ怲ƀEas⽸⾐⽺ð⽵ƀdfp໬⾙⾯ƀals⾠⾥⾪lar;挮ine;挒urf;挓Ā;t໻⾴ï໻rel;抰Āci⿀⿅r;쀀𝓅;䏈ncsp;怈̀fiopsu⿚⋢⿟⿥⿫⿱r;쀀𝔮pf;쀀𝕢rime;恗cr;쀀𝓆ƀaeo⿸〉〓tĀei⿾々rnionóڰnt;樖stĀ;e【】䀿ñἙô༔઀ABHabcdefhilmnoprstux぀けさすムㄎㄫㅇㅢㅲㆎ㈆㈕㈤㈩㉘㉮㉲㊐㊰㊷ƀartぇおがròႳòϝail;検aròᱥar;楤΀cdenqrtとふへみわゔヌĀeuねぱ;쀀∽̱te;䅕iãᅮmptyv;榳gȀ;del࿑らるろ;榒;榥å࿑uo耻»䂻rր;abcfhlpstw࿜ガクシスゼゾダッデナp;極Ā;f࿠ゴs;椠;椳s;椞ë≝ð✮l;楅im;楴l;憣;憝Āaiパフil;椚oĀ;nホボ戶aló༞ƀabrョリヮrò៥rk;杳ĀakンヽcĀekヹ・;䁽;䁝Āes㄂㄄;榌lĀduㄊㄌ;榎;榐Ȁaeuyㄗㄜㄧㄩron;䅙Ādiㄡㄥil;䅗ì࿲âヺ;䑀Ȁclqsㄴㄷㄽㅄa;椷dhar;楩uoĀ;rȎȍh;憳ƀacgㅎㅟངlȀ;ipsླྀㅘㅛႜnåႻarôྩt;断ƀilrㅩဣㅮsht;楽;쀀𝔯ĀaoㅷㆆrĀduㅽㅿ»ѻĀ;l႑ㆄ;楬Ā;vㆋㆌ䏁;䏱ƀgns㆕ㇹㇼht̀ahlrstㆤㆰ㇂㇘㇤㇮rrowĀ;t࿜ㆭaéトarpoonĀduㆻㆿowîㅾp»႒eftĀah㇊㇐rrowó࿪arpoonóՑightarrows;應quigarro÷ニhreetimes;拌g;䋚ingdotseñἲƀahm㈍㈐㈓rò࿪aòՑ;怏oustĀ;a㈞㈟掱che»㈟mid;櫮Ȁabpt㈲㈽㉀㉒Ānr㈷㈺g;柭r;懾rëဃƀafl㉇㉊㉎r;榆;쀀𝕣us;樮imes;樵Āap㉝㉧rĀ;g㉣㉤䀩t;榔olint;樒arò㇣Ȁachq㉻㊀Ⴜ㊅quo;怺r;쀀𝓇Ābu・㊊oĀ;rȔȓƀhir㊗㊛㊠reåㇸmes;拊iȀ;efl㊪ၙᠡ㊫方tri;槎luhar;楨;愞ൡ㋕㋛㋟㌬㌸㍱\0㍺㎤\0\0㏬㏰\0㐨㑈㑚㒭㒱㓊㓱\0㘖\0\0㘳cute;䅛quï➺Ԁ;Eaceinpsyᇭ㋳㋵㋿㌂㌋㌏㌟㌦㌩;檴ǰ㋺\0㋼;檸on;䅡uåᇾĀ;dᇳ㌇il;䅟rc;䅝ƀEas㌖㌘㌛;檶p;檺im;择olint;樓iíሄ;䑁otƀ;be㌴ᵇ㌵担;橦΀Aacmstx㍆㍊㍗㍛㍞㍣㍭rr;懘rĀhr㍐㍒ë∨Ā;oਸ਼਴t耻§䂧i;䀻war;椩mĀin㍩ðnuóñt;朶rĀ;o㍶⁕쀀𝔰Ȁacoy㎂㎆㎑㎠rp;景Āhy㎋㎏cy;䑉;䑈rtɭ㎙\0\0㎜iäᑤaraì⹯耻­䂭Āgm㎨㎴maƀ;fv㎱㎲㎲䏃;䏂Ѐ;deglnprካ㏅㏉㏎㏖㏞㏡㏦ot;橪Ā;q኱ኰĀ;E㏓㏔檞;檠Ā;E㏛㏜檝;檟e;扆lus;樤arr;楲aròᄽȀaeit㏸㐈㐏㐗Āls㏽㐄lsetmé㍪hp;樳parsl;槤Ādlᑣ㐔e;挣Ā;e㐜㐝檪Ā;s㐢㐣檬;쀀⪬︀ƀflp㐮㐳㑂tcy;䑌Ā;b㐸㐹䀯Ā;a㐾㐿槄r;挿f;쀀𝕤aĀdr㑍ЂesĀ;u㑔㑕晠it»㑕ƀcsu㑠㑹㒟Āau㑥㑯pĀ;sᆈ㑫;쀀⊓︀pĀ;sᆴ㑵;쀀⊔︀uĀbp㑿㒏ƀ;esᆗᆜ㒆etĀ;eᆗ㒍ñᆝƀ;esᆨᆭ㒖etĀ;eᆨ㒝ñᆮƀ;afᅻ㒦ְrť㒫ֱ»ᅼaròᅈȀcemt㒹㒾㓂㓅r;쀀𝓈tmîñiì㐕aræᆾĀar㓎㓕rĀ;f㓔ឿ昆Āan㓚㓭ightĀep㓣㓪psiloîỠhé⺯s»⡒ʀbcmnp㓻㕞ሉ㖋㖎Ҁ;Edemnprs㔎㔏㔑㔕㔞㔣㔬㔱㔶抂;櫅ot;檽Ā;dᇚ㔚ot;櫃ult;櫁ĀEe㔨㔪;櫋;把lus;檿arr;楹ƀeiu㔽㕒㕕tƀ;en㔎㕅㕋qĀ;qᇚ㔏eqĀ;q㔫㔨m;櫇Ābp㕚㕜;櫕;櫓c̀;acensᇭ㕬㕲㕹㕻㌦pproø㋺urlyeñᇾñᇳƀaes㖂㖈㌛pproø㌚qñ㌗g;晪ڀ123;Edehlmnps㖩㖬㖯ሜ㖲㖴㗀㗉㗕㗚㗟㗨㗭耻¹䂹耻²䂲耻³䂳;櫆Āos㖹㖼t;檾ub;櫘Ā;dሢ㗅ot;櫄sĀou㗏㗒l;柉b;櫗arr;楻ult;櫂ĀEe㗤㗦;櫌;抋lus;櫀ƀeiu㗴㘉㘌tƀ;enሜ㗼㘂qĀ;qሢ㖲eqĀ;q㗧㗤m;櫈Ābp㘑㘓;櫔;櫖ƀAan㘜㘠㘭rr;懙rĀhr㘦㘨ë∮Ā;oਫ਩war;椪lig耻ß䃟௡㙑㙝㙠ዎ㙳㙹\0㙾㛂\0\0\0\0\0㛛㜃\0㜉㝬\0\0\0㞇ɲ㙖\0\0㙛get;挖;䏄rë๟ƀaey㙦㙫㙰ron;䅥dil;䅣;䑂lrec;挕r;쀀𝔱Ȁeiko㚆㚝㚵㚼ǲ㚋\0㚑eĀ4fኄኁaƀ;sv㚘㚙㚛䎸ym;䏑Ācn㚢㚲kĀas㚨㚮pproø዁im»ኬsðኞĀas㚺㚮ð዁rn耻þ䃾Ǭ̟㛆⋧es膀×;bd㛏㛐㛘䃗Ā;aᤏ㛕r;樱;樰ƀeps㛡㛣㜀á⩍Ȁ;bcf҆㛬㛰㛴ot;挶ir;櫱Ā;o㛹㛼쀀𝕥rk;櫚á㍢rime;怴ƀaip㜏㜒㝤dåቈ΀adempst㜡㝍㝀㝑㝗㝜㝟ngleʀ;dlqr㜰㜱㜶㝀㝂斵own»ᶻeftĀ;e⠀㜾ñम;扜ightĀ;e㊪㝋ñၚot;旬inus;樺lus;樹b;槍ime;樻ezium;揢ƀcht㝲㝽㞁Āry㝷㝻;쀀𝓉;䑆cy;䑛rok;䅧Āio㞋㞎xô᝷headĀlr㞗㞠eftarro÷ࡏightarrow»ཝऀAHabcdfghlmoprstuw㟐㟓㟗㟤㟰㟼㠎㠜㠣㠴㡑㡝㡫㢩㣌㣒㣪㣶ròϭar;楣Ācr㟜㟢ute耻ú䃺òᅐrǣ㟪\0㟭y;䑞ve;䅭Āiy㟵㟺rc耻û䃻;䑃ƀabh㠃㠆㠋ròᎭlac;䅱aòᏃĀir㠓㠘sht;楾;쀀𝔲rave耻ù䃹š㠧㠱rĀlr㠬㠮»ॗ»ႃlk;斀Āct㠹㡍ɯ㠿\0\0㡊rnĀ;e㡅㡆挜r»㡆op;挏ri;旸Āal㡖㡚cr;䅫肻¨͉Āgp㡢㡦on;䅳f;쀀𝕦̀adhlsuᅋ㡸㡽፲㢑㢠ownáᎳarpoonĀlr㢈㢌efô㠭ighô㠯iƀ;hl㢙㢚㢜䏅»ᏺon»㢚parrows;懈ƀcit㢰㣄㣈ɯ㢶\0\0㣁rnĀ;e㢼㢽挝r»㢽op;挎ng;䅯ri;旹cr;쀀𝓊ƀdir㣙㣝㣢ot;拰lde;䅩iĀ;f㜰㣨»᠓Āam㣯㣲rò㢨l耻ü䃼angle;榧ހABDacdeflnoprsz㤜㤟㤩㤭㦵㦸㦽㧟㧤㧨㧳㧹㧽㨁㨠ròϷarĀ;v㤦㤧櫨;櫩asèϡĀnr㤲㤷grt;榜΀eknprst㓣㥆㥋㥒㥝㥤㦖appá␕othinçẖƀhir㓫⻈㥙opô⾵Ā;hᎷ㥢ïㆍĀiu㥩㥭gmá㎳Ābp㥲㦄setneqĀ;q㥽㦀쀀⊊︀;쀀⫋︀setneqĀ;q㦏㦒쀀⊋︀;쀀⫌︀Āhr㦛㦟etá㚜iangleĀlr㦪㦯eft»थight»ၑy;䐲ash»ံƀelr㧄㧒㧗ƀ;beⷪ㧋㧏ar;抻q;扚lip;拮Ābt㧜ᑨaòᑩr;쀀𝔳tré㦮suĀbp㧯㧱»ജ»൙pf;쀀𝕧roð໻tré㦴Ācu㨆㨋r;쀀𝓋Ābp㨐㨘nĀEe㦀㨖»㥾nĀEe㦒㨞»㦐igzag;榚΀cefoprs㨶㨻㩖㩛㩔㩡㩪irc;䅵Ādi㩀㩑Ābg㩅㩉ar;機eĀ;qᗺ㩏;扙erp;愘r;쀀𝔴pf;쀀𝕨Ā;eᑹ㩦atèᑹcr;쀀𝓌ૣណ㪇\0㪋\0㪐㪛\0\0㪝㪨㪫㪯\0\0㫃㫎\0㫘ៜ៟tré៑r;쀀𝔵ĀAa㪔㪗ròσrò৶;䎾ĀAa㪡㪤ròθrò৫að✓is;拻ƀdptឤ㪵㪾Āfl㪺ឩ;쀀𝕩imåឲĀAa㫇㫊ròώròਁĀcq㫒ីr;쀀𝓍Āpt៖㫜ré។Ѐacefiosu㫰㫽㬈㬌㬑㬕㬛㬡cĀuy㫶㫻te耻ý䃽;䑏Āiy㬂㬆rc;䅷;䑋n耻¥䂥r;쀀𝔶cy;䑗pf;쀀𝕪cr;쀀𝓎Ācm㬦㬩y;䑎l耻ÿ䃿Ԁacdefhiosw㭂㭈㭔㭘㭤㭩㭭㭴㭺㮀cute;䅺Āay㭍㭒ron;䅾;䐷ot;䅼Āet㭝㭡træᕟa;䎶r;쀀𝔷cy;䐶grarr;懝pf;쀀𝕫cr;쀀𝓏Ājn㮅㮇;怍j;怌`.split(``).map(e=>e.charCodeAt(0))),me=new Uint16Array(`Ȁaglq	\x1Bɭ\0\0p;䀦os;䀧t;䀾t;䀼uot;䀢`.split(``).map(e=>e.charCodeAt(0))),he=new Map([[0,65533],[128,8364],[130,8218],[131,402],[132,8222],[133,8230],[134,8224],[135,8225],[136,710],[137,8240],[138,352],[139,8249],[140,338],[142,381],[145,8216],[146,8217],[147,8220],[148,8221],[149,8226],[150,8211],[151,8212],[152,732],[153,8482],[154,353],[155,8250],[156,339],[158,382],[159,376]]),ge=String.fromCodePoint??function(e){let t=``;return e>65535&&(e-=65536,t+=String.fromCharCode(e>>>10&1023|55296),e=56320|e&1023),t+=String.fromCharCode(e),t};function _e(e){return e>=55296&&e<=57343||e>1114111?65533:he.get(e)??e}var b;(function(e){e[e.NUM=35]=`NUM`,e[e.SEMI=59]=`SEMI`,e[e.EQUALS=61]=`EQUALS`,e[e.ZERO=48]=`ZERO`,e[e.NINE=57]=`NINE`,e[e.LOWER_A=97]=`LOWER_A`,e[e.LOWER_F=102]=`LOWER_F`,e[e.LOWER_X=120]=`LOWER_X`,e[e.LOWER_Z=122]=`LOWER_Z`,e[e.UPPER_A=65]=`UPPER_A`,e[e.UPPER_F=70]=`UPPER_F`,e[e.UPPER_Z=90]=`UPPER_Z`})(b||={});var ve=32,x;(function(e){e[e.VALUE_LENGTH=49152]=`VALUE_LENGTH`,e[e.BRANCH_LENGTH=16256]=`BRANCH_LENGTH`,e[e.JUMP_TABLE=127]=`JUMP_TABLE`})(x||={});function ye(e){return e>=b.ZERO&&e<=b.NINE}function be(e){return e>=b.UPPER_A&&e<=b.UPPER_F||e>=b.LOWER_A&&e<=b.LOWER_F}function xe(e){return e>=b.UPPER_A&&e<=b.UPPER_Z||e>=b.LOWER_A&&e<=b.LOWER_Z||ye(e)}function Se(e){return e===b.EQUALS||xe(e)}var S;(function(e){e[e.EntityStart=0]=`EntityStart`,e[e.NumericStart=1]=`NumericStart`,e[e.NumericDecimal=2]=`NumericDecimal`,e[e.NumericHex=3]=`NumericHex`,e[e.NamedEntity=4]=`NamedEntity`})(S||={});var C;(function(e){e[e.Legacy=0]=`Legacy`,e[e.Strict=1]=`Strict`,e[e.Attribute=2]=`Attribute`})(C||={});var Ce=class{constructor(e,t,n){this.decodeTree=e,this.emitCodePoint=t,this.errors=n,this.state=S.EntityStart,this.consumed=1,this.result=0,this.treeIndex=0,this.excess=1,this.decodeMode=C.Strict}startEntity(e){this.decodeMode=e,this.state=S.EntityStart,this.result=0,this.treeIndex=0,this.excess=1,this.consumed=1}write(e,t){switch(this.state){case S.EntityStart:return e.charCodeAt(t)===b.NUM?(this.state=S.NumericStart,this.consumed+=1,this.stateNumericStart(e,t+1)):(this.state=S.NamedEntity,this.stateNamedEntity(e,t));case S.NumericStart:return this.stateNumericStart(e,t);case S.NumericDecimal:return this.stateNumericDecimal(e,t);case S.NumericHex:return this.stateNumericHex(e,t);case S.NamedEntity:return this.stateNamedEntity(e,t)}}stateNumericStart(e,t){return t>=e.length?-1:(e.charCodeAt(t)|ve)===b.LOWER_X?(this.state=S.NumericHex,this.consumed+=1,this.stateNumericHex(e,t+1)):(this.state=S.NumericDecimal,this.stateNumericDecimal(e,t))}addToNumericResult(e,t,n,r){if(t!==n){let i=n-t;this.result=this.result*r**+i+parseInt(e.substr(t,i),r),this.consumed+=i}}stateNumericHex(e,t){let n=t;for(;t<e.length;){let r=e.charCodeAt(t);if(ye(r)||be(r))t+=1;else return this.addToNumericResult(e,n,t,16),this.emitNumericEntity(r,3)}return this.addToNumericResult(e,n,t,16),-1}stateNumericDecimal(e,t){let n=t;for(;t<e.length;){let r=e.charCodeAt(t);if(ye(r))t+=1;else return this.addToNumericResult(e,n,t,10),this.emitNumericEntity(r,2)}return this.addToNumericResult(e,n,t,10),-1}emitNumericEntity(e,t){var n;if(this.consumed<=t)return(n=this.errors)==null||n.absenceOfDigitsInNumericCharacterReference(this.consumed),0;if(e===b.SEMI)this.consumed+=1;else if(this.decodeMode===C.Strict)return 0;return this.emitCodePoint(_e(this.result),this.consumed),this.errors&&(e!==b.SEMI&&this.errors.missingSemicolonAfterCharacterReference(),this.errors.validateNumericCharacterReference(this.result)),this.consumed}stateNamedEntity(e,t){let{decodeTree:n}=this,r=n[this.treeIndex],i=(r&x.VALUE_LENGTH)>>14;for(;t<e.length;t++,this.excess++){let a=e.charCodeAt(t);if(this.treeIndex=Te(n,r,this.treeIndex+Math.max(1,i),a),this.treeIndex<0)return this.result===0||this.decodeMode===C.Attribute&&(i===0||Se(a))?0:this.emitNotTerminatedNamedEntity();if(r=n[this.treeIndex],i=(r&x.VALUE_LENGTH)>>14,i!==0){if(a===b.SEMI)return this.emitNamedEntityData(this.treeIndex,i,this.consumed+this.excess);this.decodeMode!==C.Strict&&(this.result=this.treeIndex,this.consumed+=this.excess,this.excess=0)}}return-1}emitNotTerminatedNamedEntity(){var e;let{result:t,decodeTree:n}=this,r=(n[t]&x.VALUE_LENGTH)>>14;return this.emitNamedEntityData(t,r,this.consumed),(e=this.errors)==null||e.missingSemicolonAfterCharacterReference(),this.consumed}emitNamedEntityData(e,t,n){let{decodeTree:r}=this;return this.emitCodePoint(t===1?r[e]&~x.VALUE_LENGTH:r[e+1],n),t===3&&this.emitCodePoint(r[e+2],n),n}end(){var e;switch(this.state){case S.NamedEntity:return this.result!==0&&(this.decodeMode!==C.Attribute||this.result===this.treeIndex)?this.emitNotTerminatedNamedEntity():0;case S.NumericDecimal:return this.emitNumericEntity(0,2);case S.NumericHex:return this.emitNumericEntity(0,3);case S.NumericStart:return(e=this.errors)==null||e.absenceOfDigitsInNumericCharacterReference(this.consumed),0;case S.EntityStart:return 0}}};function we(e){let t=``,n=new Ce(e,e=>t+=ge(e));return function(e,r){let i=0,a=0;for(;(a=e.indexOf(`&`,a))>=0;){t+=e.slice(i,a),n.startEntity(r);let o=n.write(e,a+1);if(o<0){i=a+n.end();break}i=a+o,a=o===0?i+1:i}let o=t+e.slice(i);return t=``,o}}function Te(e,t,n,r){let i=(t&x.BRANCH_LENGTH)>>7,a=t&x.JUMP_TABLE;if(i===0)return a!==0&&r===a?n:-1;if(a){let t=r-a;return t<0||t>=i?-1:e[n+t]-1}let o=n,s=o+i-1;for(;o<=s;){let t=o+s>>>1,n=e[t];if(n<r)o=t+1;else if(n>r)s=t-1;else return e[t+i]}return-1}var Ee=we(pe);we(me);function De(e,t=C.Legacy){return Ee(e,t)}function Oe(e){return Ee(e,C.Strict)}var ke=t({arrayReplaceAt:()=>Fe,asciiTrim:()=>Ze,assign:()=>Pe,escapeHtml:()=>E,escapeRE:()=>qe,fromCodePoint:()=>w,has:()=>Ne,isMdAsciiPunct:()=>A,isPunctChar:()=>Je,isPunctCharCode:()=>k,isSpace:()=>D,isString:()=>je,isValidEntityCode:()=>Ie,isWhiteSpace:()=>O,lib:()=>Qe,normalizeReference:()=>Ye,unescapeAll:()=>T,unescapeMd:()=>Ve});function Ae(e){return Object.prototype.toString.call(e)}function je(e){return Ae(e)===`[object String]`}var Me=Object.prototype.hasOwnProperty;function Ne(e,t){return Me.call(e,t)}function Pe(e){return Array.prototype.slice.call(arguments,1).forEach(function(t){if(t){if(typeof t!=`object`)throw TypeError(t+`must be object`);Object.keys(t).forEach(function(n){e[n]=t[n]})}}),e}function Fe(e,t,n){return[].concat(e.slice(0,t),n,e.slice(t+1))}function Ie(e){return!(e>=55296&&e<=57343||e>=64976&&e<=65007||(e&65535)==65535||(e&65535)==65534||e>=0&&e<=8||e===11||e>=14&&e<=31||e>=127&&e<=159||e>1114111)}function w(e){if(e>65535){e-=65536;let t=55296+(e>>10),n=56320+(e&1023);return String.fromCharCode(t,n)}return String.fromCharCode(e)}var Le=/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,Re=RegExp(Le.source+`|&([a-z#][a-z0-9]{1,31});`,`gi`),ze=/^#((?:x[a-f0-9]{1,8}|[0-9]{1,8}))$/i;function Be(e,t){if(t.charCodeAt(0)===35&&ze.test(t)){let n=t[1].toLowerCase()===`x`?parseInt(t.slice(2),16):parseInt(t.slice(1),10);return Ie(n)?w(n):e}let n=De(e);return n===e?e:n}function Ve(e){return e.indexOf(`\\`)<0?e:e.replace(Le,`$1`)}function T(e){return e.indexOf(`\\`)<0&&e.indexOf(`&`)<0?e:e.replace(Re,function(e,t,n){return t||Be(e,n)})}var He=/[&<>"]/,Ue=/[&<>"]/g,We={"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`};function Ge(e){return We[e]}function E(e){return He.test(e)?e.replace(Ue,Ge):e}var Ke=/[.?*+^$[\]\\(){}|-]/g;function qe(e){return e.replace(Ke,`\\$&`)}function D(e){switch(e){case 9:case 32:return!0}return!1}function O(e){if(e>=8192&&e<=8202)return!0;switch(e){case 9:case 10:case 11:case 12:case 13:case 32:case 160:case 5760:case 8239:case 8287:case 12288:return!0}return!1}function Je(e){return le.test(e)||ue.test(e)}function k(e){return Je(w(e))}function A(e){switch(e){case 33:case 34:case 35:case 36:case 37:case 38:case 39:case 40:case 41:case 42:case 43:case 44:case 45:case 46:case 47:case 58:case 59:case 60:case 61:case 62:case 63:case 64:case 91:case 92:case 93:case 94:case 95:case 96:case 123:case 124:case 125:case 126:return!0;default:return!1}}function Ye(e){return e=e.trim().replace(/\s+/g,` `),e.toLowerCase().toUpperCase()}function Xe(e){return e===32||e===9||e===10||e===13}function Ze(e){let t=0;for(;t<e.length&&Xe(e.charCodeAt(t));t++);let n=e.length-1;for(;n>=t&&Xe(e.charCodeAt(n));n--);return e.slice(t,n+1)}var Qe={mdurl:ae,ucmicro:fe};function $e(e,t,n){let r,i,a,o,s=e.posMax,c=e.pos;for(e.pos=t+1,r=1;e.pos<s;){if(a=e.src.charCodeAt(e.pos),a===93&&(r--,r===0)){i=!0;break}if(o=e.pos,e.md.inline.skipToken(e),a===91){if(o===e.pos-1)r++;else if(n)return e.pos=c,-1}}let l=-1;return i&&(l=e.pos),e.pos=c,l}function et(e,t,n){let r,i=t,a={ok:!1,pos:0,str:``};if(e.charCodeAt(i)===60){for(i++;i<n;){if(r=e.charCodeAt(i),r===10||r===60)return a;if(r===62)return a.pos=i+1,a.str=T(e.slice(t+1,i)),a.ok=!0,a;if(r===92&&i+1<n){i+=2;continue}i++}return a}let o=0;for(;i<n&&(r=e.charCodeAt(i),!(r===32||r<32||r===127));){if(r===92&&i+1<n){if(e.charCodeAt(i+1)===32)break;i+=2;continue}if(r===40&&(o++,o>32))return a;if(r===41){if(o===0)break;o--}i++}return t===i||o!==0?a:(a.str=T(e.slice(t,i)),a.pos=i,a.ok=!0,a)}function tt(e,t,n,r){let i,a=t,o={ok:!1,can_continue:!1,pos:0,str:``,marker:0};if(r)o.str=r.str,o.marker=r.marker;else{if(a>=n)return o;let r=e.charCodeAt(a);if(r!==34&&r!==39&&r!==40)return o;t++,a++,r===40&&(r=41),o.marker=r}for(;a<n;){if(i=e.charCodeAt(a),i===o.marker)return o.pos=a+1,o.str+=T(e.slice(t,a)),o.ok=!0,o;if(i===40&&o.marker===41)return o;i===92&&a+1<n&&a++,a++}return o.can_continue=!0,o.str+=T(e.slice(t,a)),o}var nt=t({parseLinkDestination:()=>et,parseLinkLabel:()=>$e,parseLinkTitle:()=>tt}),j={};j.code_inline=function(e,t,n,r,i){let a=e[t];return`<code`+i.renderAttrs(a)+`>`+E(a.content)+`</code>`},j.code_block=function(e,t,n,r,i){let a=e[t];return`<pre`+i.renderAttrs(a)+`><code>`+E(e[t].content)+`</code></pre>
`},j.fence=function(e,t,n,r,i){let a=e[t],o=a.info?T(a.info).trim():``,s=``,c=``;if(o){let e=o.split(/(\s+)/g);s=e[0],c=e.slice(2).join(``)}let l;if(l=n.highlight&&n.highlight(a.content,s,c)||E(a.content),l.indexOf(`<pre`)===0)return l+`
`;if(o){let e=a.attrIndex(`class`),t=a.attrs?a.attrs.slice():[];e<0?t.push([`class`,n.langPrefix+s]):(t[e]=t[e].slice(),t[e][1]+=` `+n.langPrefix+s);let r={attrs:t};return`<pre><code${i.renderAttrs(r)}>${l}</code></pre>\n`}return`<pre><code${i.renderAttrs(a)}>${l}</code></pre>\n`},j.image=function(e,t,n,r,i){let a=e[t];return a.attrs[a.attrIndex(`alt`)][1]=i.renderInlineAsText(a.children,n,r),i.renderToken(e,t,n)},j.hardbreak=function(e,t,n){return n.xhtmlOut?`<br />
`:`<br>
`},j.softbreak=function(e,t,n){return n.breaks?n.xhtmlOut?`<br />
`:`<br>
`:`
`},j.text=function(e,t){return E(e[t].content)},j.html_block=function(e,t){return e[t].content},j.html_inline=function(e,t){return e[t].content};function M(){this.rules=Pe({},j)}M.prototype.renderAttrs=function(e){let t,n,r;if(!e.attrs)return``;for(r=``,t=0,n=e.attrs.length;t<n;t++)r+=` `+E(e.attrs[t][0])+`="`+E(e.attrs[t][1])+`"`;return r},M.prototype.renderToken=function(e,t,n){let r=e[t],i=``;if(r.hidden)return``;r.block&&r.nesting!==-1&&t&&e[t-1].hidden&&(i+=`
`),i+=(r.nesting===-1?`</`:`<`)+r.tag,i+=this.renderAttrs(r),r.nesting===0&&n.xhtmlOut&&(i+=` /`);let a=!1;if(r.block&&(a=!0,r.nesting===1&&t+1<e.length)){let n=e[t+1];(n.type===`inline`||n.hidden||n.nesting===-1&&n.tag===r.tag)&&(a=!1)}return i+=a?`>
`:`>`,i},M.prototype.renderInline=function(e,t,n){let r=``,i=this.rules;for(let a=0,o=e.length;a<o;a++){let o=e[a].type;i[o]===void 0?r+=this.renderToken(e,a,t):r+=i[o](e,a,t,n,this)}return r},M.prototype.renderInlineAsText=function(e,t,n){let r=``;for(let i=0,a=e.length;i<a;i++)switch(e[i].type){case`text`:r+=e[i].content;break;case`image`:r+=this.renderInlineAsText(e[i].children,t,n);break;case`html_inline`:case`html_block`:r+=e[i].content;break;case`softbreak`:case`hardbreak`:r+=`
`;break;default:}return r},M.prototype.render=function(e,t,n){let r=``,i=this.rules;for(let a=0,o=e.length;a<o;a++){let o=e[a].type;o===`inline`?r+=this.renderInline(e[a].children,t,n):i[o]===void 0?r+=this.renderToken(e,a,t,n):r+=i[o](e,a,t,n,this)}return r};function N(){this.__rules__=[],this.__cache__=null}N.prototype.__find__=function(e){for(let t=0;t<this.__rules__.length;t++)if(this.__rules__[t].name===e)return t;return-1},N.prototype.__compile__=function(){let e=this,t=[``];e.__rules__.forEach(function(e){e.enabled&&e.alt.forEach(function(e){t.indexOf(e)<0&&t.push(e)})}),e.__cache__={},t.forEach(function(t){e.__cache__[t]=[],e.__rules__.forEach(function(n){n.enabled&&(t&&n.alt.indexOf(t)<0||e.__cache__[t].push(n.fn))})})},N.prototype.at=function(e,t,n){let r=this.__find__(e),i=n||{};if(r===-1)throw Error(`Parser rule not found: `+e);this.__rules__[r].fn=t,this.__rules__[r].alt=i.alt||[],this.__cache__=null},N.prototype.before=function(e,t,n,r){let i=this.__find__(e),a=r||{};if(i===-1)throw Error(`Parser rule not found: `+e);this.__rules__.splice(i,0,{name:t,enabled:!0,fn:n,alt:a.alt||[]}),this.__cache__=null},N.prototype.after=function(e,t,n,r){let i=this.__find__(e),a=r||{};if(i===-1)throw Error(`Parser rule not found: `+e);this.__rules__.splice(i+1,0,{name:t,enabled:!0,fn:n,alt:a.alt||[]}),this.__cache__=null},N.prototype.push=function(e,t,n){let r=n||{};this.__rules__.push({name:e,enabled:!0,fn:t,alt:r.alt||[]}),this.__cache__=null},N.prototype.enable=function(e,t){Array.isArray(e)||(e=[e]);let n=[];return e.forEach(function(e){let r=this.__find__(e);if(r<0){if(t)return;throw Error(`Rules manager: invalid rule name `+e)}this.__rules__[r].enabled=!0,n.push(e)},this),this.__cache__=null,n},N.prototype.enableOnly=function(e,t){Array.isArray(e)||(e=[e]),this.__rules__.forEach(function(e){e.enabled=!1}),this.enable(e,t)},N.prototype.disable=function(e,t){Array.isArray(e)||(e=[e]);let n=[];return e.forEach(function(e){let r=this.__find__(e);if(r<0){if(t)return;throw Error(`Rules manager: invalid rule name `+e)}this.__rules__[r].enabled=!1,n.push(e)},this),this.__cache__=null,n},N.prototype.getRules=function(e){return this.__cache__===null&&this.__compile__(),this.__cache__[e]||[]};function P(e,t,n){this.type=e,this.tag=t,this.attrs=null,this.map=null,this.nesting=n,this.level=0,this.children=null,this.content=``,this.markup=``,this.info=``,this.meta=null,this.block=!1,this.hidden=!1}P.prototype.attrIndex=function(e){if(!this.attrs)return-1;let t=this.attrs;for(let n=0,r=t.length;n<r;n++)if(t[n][0]===e)return n;return-1},P.prototype.attrPush=function(e){this.attrs?this.attrs.push(e):this.attrs=[e]},P.prototype.attrSet=function(e,t){let n=this.attrIndex(e),r=[e,t];n<0?this.attrPush(r):this.attrs[n]=r},P.prototype.attrGet=function(e){let t=this.attrIndex(e),n=null;return t>=0&&(n=this.attrs[t][1]),n},P.prototype.attrJoin=function(e,t){let n=this.attrIndex(e);n<0?this.attrPush([e,t]):this.attrs[n][1]=this.attrs[n][1]+` `+t};function rt(e,t,n){this.src=e,this.env=n,this.tokens=[],this.inlineMode=!1,this.md=t}rt.prototype.Token=P;var it=/\r\n?|\n/g,at=/\0/g;function ot(e){let t;t=e.src.replace(it,`
`),t=t.replace(at,`�`),e.src=t}function st(e){let t;e.inlineMode?(t=new e.Token(`inline`,``,0),t.content=e.src,t.map=[0,1],t.children=[],e.tokens.push(t)):e.md.block.parse(e.src,e.md,e.env,e.tokens)}function ct(e){let t=e.tokens;for(let n=0,r=t.length;n<r;n++){let r=t[n];r.type===`inline`&&e.md.inline.parse(r.content,e.md,e.env,r.children)}}function lt(e){return/^<a[>\s]/i.test(e)}function ut(e){return/^<\/a\s*>/i.test(e)}function dt(e){let t=e.tokens;if(e.md.options.linkify)for(let n=0,r=t.length;n<r;n++){if(t[n].type!==`inline`||!e.md.linkify.pretest(t[n].content))continue;let r=t[n].children,i=0;for(let a=r.length-1;a>=0;a--){let o=r[a];if(o.type===`link_close`){for(a--;r[a].level!==o.level&&r[a].type!==`link_open`;)a--;continue}if(o.type===`html_inline`&&(lt(o.content)&&i>0&&i--,ut(o.content)&&i++),!(i>0)&&o.type===`text`&&e.md.linkify.test(o.content)){let i=o.content,s=e.md.linkify.match(i),c=[],l=o.level,u=0;s.length>0&&s[0].index===0&&a>0&&r[a-1].type===`text_special`&&(s=s.slice(1));for(let t=0;t<s.length;t++){let n=s[t].url,r=e.md.normalizeLink(n);if(!e.md.validateLink(r))continue;let a=s[t].text;a=s[t].schema?s[t].schema===`mailto:`&&!/^mailto:/i.test(a)?e.md.normalizeLinkText(`mailto:`+a).replace(/^mailto:/,``):e.md.normalizeLinkText(a):e.md.normalizeLinkText(`http://`+a).replace(/^http:\/\//,``);let o=s[t].index;if(o>u){let t=new e.Token(`text`,``,0);t.content=i.slice(u,o),t.level=l,c.push(t)}let d=new e.Token(`link_open`,`a`,1);d.attrs=[[`href`,r]],d.level=l++,d.markup=`linkify`,d.info=`auto`,c.push(d);let f=new e.Token(`text`,``,0);f.content=a,f.level=l,c.push(f);let p=new e.Token(`link_close`,`a`,-1);p.level=--l,p.markup=`linkify`,p.info=`auto`,c.push(p),u=s[t].lastIndex}if(u<i.length){let t=new e.Token(`text`,``,0);t.content=i.slice(u),t.level=l,c.push(t)}t[n].children=r=Fe(r,a,c)}}}}var ft=/\+-|\.\.|\?\?\?\?|!!!!|,,|--/,pt=/\((c|tm|r)\)/i,mt=/\((c|tm|r)\)/gi,ht={c:`©`,r:`®`,tm:`™`};function gt(e,t){return ht[t.toLowerCase()]}function _t(e){let t=0;for(let n=e.length-1;n>=0;n--){let r=e[n];r.type===`text`&&!t&&(r.content=r.content.replace(mt,gt)),r.type===`link_open`&&r.info===`auto`&&t--,r.type===`link_close`&&r.info===`auto`&&t++}}function vt(e){let t=0;for(let n=e.length-1;n>=0;n--){let r=e[n];r.type===`text`&&!t&&ft.test(r.content)&&(r.content=r.content.replace(/\+-/g,`±`).replace(/\.{2,}/g,`…`).replace(/([?!])…/g,`$1..`).replace(/([?!]){4,}/g,`$1$1$1`).replace(/,{2,}/g,`,`).replace(/(^|[^-])---(?=[^-]|$)/gm,`$1—`).replace(/(^|\s)--(?=\s|$)/gm,`$1–`).replace(/(^|[^-\s])--(?=[^-\s]|$)/gm,`$1–`)),r.type===`link_open`&&r.info===`auto`&&t--,r.type===`link_close`&&r.info===`auto`&&t++}}function yt(e){let t;if(e.md.options.typographer)for(t=e.tokens.length-1;t>=0;t--)e.tokens[t].type===`inline`&&(pt.test(e.tokens[t].content)&&_t(e.tokens[t].children),ft.test(e.tokens[t].content)&&vt(e.tokens[t].children))}var bt=/['"]/,xt=/['"]/g,St=`’`;function Ct(e,t,n,r){e[t]||(e[t]=[]),e[t].push({pos:n,ch:r})}function wt(e,t){let n=``,r=0;t.sort((e,t)=>e.pos-t.pos);for(let i=0;i<t.length;i++){let a=t[i];n+=e.slice(r,a.pos)+a.ch,r=a.pos+1}return n+e.slice(r)}function Tt(e,t){let n,r=[],i={};for(let a=0;a<e.length;a++){let o=e[a],s=e[a].level;for(n=r.length-1;n>=0&&!(r[n].level<=s);n--);if(r.length=n+1,o.type!==`text`)continue;let c=o.content,l=0,u=c.length;OUTER:for(;l<u;){xt.lastIndex=l;let o=xt.exec(c);if(!o)break;let d=!0,f=!0;l=o.index+1;let p=o[0]===`'`,m=32;if(o.index-1>=0)m=c.charCodeAt(o.index-1);else for(n=a-1;n>=0&&!(e[n].type===`softbreak`||e[n].type===`hardbreak`);n--)if(e[n].content){m=e[n].content.charCodeAt(e[n].content.length-1);break}let h=32;if(l<u)h=c.charCodeAt(l);else for(n=a+1;n<e.length&&!(e[n].type===`softbreak`||e[n].type===`hardbreak`);n++)if(e[n].content){h=e[n].content.charCodeAt(0);break}let g=A(m)||k(m),_=A(h)||k(h),v=O(m),y=O(h);if(y?d=!1:_&&(v||g||(d=!1)),v?f=!1:g&&(y||_||(f=!1)),h===34&&o[0]===`"`&&m>=48&&m<=57&&(f=d=!1),d&&f&&(d=g,f=_),!d&&!f){p&&Ct(i,a,o.index,St);continue}if(f)for(n=r.length-1;n>=0;n--){let e=r[n];if(r[n].level<s)break;if(e.single===p&&r[n].level===s){e=r[n];let s,c;p?(s=t.md.options.quotes[2],c=t.md.options.quotes[3]):(s=t.md.options.quotes[0],c=t.md.options.quotes[1]),Ct(i,a,o.index,c),Ct(i,e.token,e.pos,s),r.length=n;continue OUTER}}d?r.push({token:a,pos:o.index,single:p,level:s}):f&&p&&Ct(i,a,o.index,St)}}Object.keys(i).forEach(function(t){e[t].content=wt(e[t].content,i[t])})}function Et(e){if(e.md.options.typographer)for(let t=e.tokens.length-1;t>=0;t--)e.tokens[t].type!==`inline`||!bt.test(e.tokens[t].content)||Tt(e.tokens[t].children,e)}function Dt(e){let t,n,r=e.tokens,i=r.length;for(let e=0;e<i;e++){if(r[e].type!==`inline`)continue;let i=r[e].children,a=i.length;for(t=0;t<a;t++)i[t].type===`text_special`&&(i[t].type=`text`);for(t=n=0;t<a;t++)i[t].type===`text`&&t+1<a&&i[t+1].type===`text`?i[t+1].content=i[t].content+i[t+1].content:(t!==n&&(i[n]=i[t]),n++);t!==n&&(i.length=n)}}var Ot=[[`normalize`,ot],[`block`,st],[`inline`,ct],[`linkify`,dt],[`replacements`,yt],[`smartquotes`,Et],[`text_join`,Dt]];function kt(){this.ruler=new N;for(let e=0;e<Ot.length;e++)this.ruler.push(Ot[e][0],Ot[e][1])}kt.prototype.process=function(e){let t=this.ruler.getRules(``);for(let n=0,r=t.length;n<r;n++)t[n](e)},kt.prototype.State=rt;function F(e,t,n,r){this.src=e,this.md=t,this.env=n,this.tokens=r,this.bMarks=[],this.eMarks=[],this.tShift=[],this.sCount=[],this.bsCount=[],this.blkIndent=0,this.line=0,this.lineMax=0,this.tight=!1,this.ddIndent=-1,this.listIndent=-1,this.parentType=`root`,this.level=0;let i=this.src;for(let e=0,t=0,n=0,r=0,a=i.length,o=!1;t<a;t++){let s=i.charCodeAt(t);if(!o)if(D(s)){n++,s===9?r+=4-r%4:r++;continue}else o=!0;(s===10||t===a-1)&&(s!==10&&t++,this.bMarks.push(e),this.eMarks.push(t),this.tShift.push(n),this.sCount.push(r),this.bsCount.push(0),o=!1,n=0,r=0,e=t+1)}this.bMarks.push(i.length),this.eMarks.push(i.length),this.tShift.push(0),this.sCount.push(0),this.bsCount.push(0),this.lineMax=this.bMarks.length-1}F.prototype.push=function(e,t,n){let r=new P(e,t,n);return r.block=!0,n<0&&this.level--,r.level=this.level,n>0&&this.level++,this.tokens.push(r),r},F.prototype.isEmpty=function(e){return this.bMarks[e]+this.tShift[e]>=this.eMarks[e]},F.prototype.skipEmptyLines=function(e){for(let t=this.lineMax;e<t&&!(this.bMarks[e]+this.tShift[e]<this.eMarks[e]);e++);return e},F.prototype.skipSpaces=function(e){for(let t=this.src.length;e<t&&D(this.src.charCodeAt(e));e++);return e},F.prototype.skipSpacesBack=function(e,t){if(e<=t)return e;for(;e>t;)if(!D(this.src.charCodeAt(--e)))return e+1;return e},F.prototype.skipChars=function(e,t){for(let n=this.src.length;e<n&&this.src.charCodeAt(e)===t;e++);return e},F.prototype.skipCharsBack=function(e,t,n){if(e<=n)return e;for(;e>n;)if(t!==this.src.charCodeAt(--e))return e+1;return e},F.prototype.getLines=function(e,t,n,r){if(e>=t)return``;let i=Array(t-e);for(let a=0,o=e;o<t;o++,a++){let e=0,s=this.bMarks[o],c=s,l;for(l=o+1<t||r?this.eMarks[o]+1:this.eMarks[o];c<l&&e<n;){let t=this.src.charCodeAt(c);if(D(t))t===9?e+=4-(e+this.bsCount[o])%4:e++;else if(c-s<this.tShift[o])e++;else break;c++}e>n?i[a]=Array(e-n+1).join(` `)+this.src.slice(c,l):i[a]=this.src.slice(c,l)}return i.join(``)},F.prototype.Token=P;var At=65536;function jt(e,t){let n=e.bMarks[t]+e.tShift[t],r=e.eMarks[t];return e.src.slice(n,r)}function Mt(e){let t=[],n=e.length,r=0,i=e.charCodeAt(r),a=!1,o=0,s=``;for(;r<n;)i===124&&(a?(s+=e.substring(o,r-1),o=r):(t.push(s+e.substring(o,r)),s=``,o=r+1)),a=i===92,r++,i=e.charCodeAt(r);return t.push(s+e.substring(o)),t}function Nt(e,t,n,r){if(t+2>n)return!1;let i=t+1;if(e.sCount[i]<e.blkIndent||e.sCount[i]-e.blkIndent>=4)return!1;let a=e.bMarks[i]+e.tShift[i];if(a>=e.eMarks[i])return!1;let o=e.src.charCodeAt(a++);if(o!==124&&o!==45&&o!==58||a>=e.eMarks[i])return!1;let s=e.src.charCodeAt(a++);if(s!==124&&s!==45&&s!==58&&!D(s)||o===45&&D(s))return!1;for(;a<e.eMarks[i];){let t=e.src.charCodeAt(a);if(t!==124&&t!==45&&t!==58&&!D(t))return!1;a++}let c=jt(e,t+1),l=c.split(`|`),u=[];for(let e=0;e<l.length;e++){let t=l[e].trim();if(!t){if(e===0||e===l.length-1)continue;return!1}if(!/^:?-+:?$/.test(t))return!1;t.charCodeAt(t.length-1)===58?u.push(t.charCodeAt(0)===58?`center`:`right`):t.charCodeAt(0)===58?u.push(`left`):u.push(``)}if(c=jt(e,t).trim(),c.indexOf(`|`)===-1||e.sCount[t]-e.blkIndent>=4)return!1;l=Mt(c),l.length&&l[0]===``&&l.shift(),l.length&&l[l.length-1]===``&&l.pop();let d=l.length;if(d===0||d!==u.length)return!1;if(r)return!0;let f=e.parentType;e.parentType=`table`;let p=e.md.block.ruler.getRules(`blockquote`),m=e.push(`table_open`,`table`,1),h=[t,0];m.map=h;let g=e.push(`thead_open`,`thead`,1);g.map=[t,t+1];let _=e.push(`tr_open`,`tr`,1);_.map=[t,t+1];for(let t=0;t<l.length;t++){let n=e.push(`th_open`,`th`,1);u[t]&&(n.attrs=[[`style`,`text-align:`+u[t]]]);let r=e.push(`inline`,``,0);r.content=l[t].trim(),r.children=[],e.push(`th_close`,`th`,-1)}e.push(`tr_close`,`tr`,-1),e.push(`thead_close`,`thead`,-1);let v,y=0;for(i=t+2;i<n&&!(e.sCount[i]<e.blkIndent);i++){let r=!1;for(let t=0,a=p.length;t<a;t++)if(p[t](e,i,n,!0)){r=!0;break}if(r||(c=jt(e,i).trim(),!c)||e.sCount[i]-e.blkIndent>=4||(l=Mt(c),l.length&&l[0]===``&&l.shift(),l.length&&l[l.length-1]===``&&l.pop(),y+=d-l.length,y>At))break;if(i===t+2){let n=e.push(`tbody_open`,`tbody`,1);n.map=v=[t+2,0]}let a=e.push(`tr_open`,`tr`,1);a.map=[i,i+1];for(let t=0;t<d;t++){let n=e.push(`td_open`,`td`,1);u[t]&&(n.attrs=[[`style`,`text-align:`+u[t]]]);let r=e.push(`inline`,``,0);r.content=l[t]?l[t].trim():``,r.children=[],e.push(`td_close`,`td`,-1)}e.push(`tr_close`,`tr`,-1)}return v&&(e.push(`tbody_close`,`tbody`,-1),v[1]=i),e.push(`table_close`,`table`,-1),h[1]=i,e.parentType=f,e.line=i,!0}function Pt(e,t,n){if(e.sCount[t]-e.blkIndent<4)return!1;let r=t+1,i=r;for(;r<n;){if(e.isEmpty(r)){r++;continue}if(e.sCount[r]-e.blkIndent>=4){r++,i=r;continue}break}e.line=i;let a=e.push(`code_block`,`code`,0);return a.content=e.getLines(t,i,4+e.blkIndent,!1)+`
`,a.map=[t,e.line],!0}function Ft(e,t,n,r){let i=e.bMarks[t]+e.tShift[t],a=e.eMarks[t];if(e.sCount[t]-e.blkIndent>=4||i+3>a)return!1;let o=e.src.charCodeAt(i);if(o!==126&&o!==96)return!1;let s=i;i=e.skipChars(i,o);let c=i-s;if(c<3)return!1;let l=e.src.slice(s,i),u=e.src.slice(i,a);if(o===96&&u.indexOf(String.fromCharCode(o))>=0)return!1;if(r)return!0;let d=t,f=!1;for(;d++,!(d>=n||(i=s=e.bMarks[d]+e.tShift[d],a=e.eMarks[d],i<a&&e.sCount[d]<e.blkIndent));)if(e.src.charCodeAt(i)===o&&!(e.sCount[d]-e.blkIndent>=4)&&(i=e.skipChars(i,o),!(i-s<c)&&(i=e.skipSpaces(i),!(i<a)))){f=!0;break}c=e.sCount[t],e.line=d+ +!!f;let p=e.push(`fence`,`code`,0);return p.info=u,p.content=e.getLines(t+1,d,c,!0),p.markup=l,p.map=[t,e.line],!0}function It(e,t,n,r){let i=e.bMarks[t]+e.tShift[t],a=e.eMarks[t],o=e.lineMax;if(e.sCount[t]-e.blkIndent>=4||e.src.charCodeAt(i)!==62)return!1;if(r)return!0;let s=[],c=[],l=[],u=[],d=e.md.block.ruler.getRules(`blockquote`),f=e.parentType;e.parentType=`blockquote`;let p=!1,m;for(m=t;m<n;m++){let t=e.sCount[m]<e.blkIndent;if(i=e.bMarks[m]+e.tShift[m],a=e.eMarks[m],i>=a)break;if(e.src.charCodeAt(i++)===62&&!t){let t=e.sCount[m]+1,n,r;e.src.charCodeAt(i)===32?(i++,t++,r=!1,n=!0):e.src.charCodeAt(i)===9?(n=!0,(e.bsCount[m]+t)%4==3?(i++,t++,r=!1):r=!0):n=!1;let o=t;for(s.push(e.bMarks[m]),e.bMarks[m]=i;i<a;){let t=e.src.charCodeAt(i);if(D(t))t===9?o+=4-(o+e.bsCount[m]+ +!!r)%4:o++;else break;i++}p=i>=a,c.push(e.bsCount[m]),e.bsCount[m]=e.sCount[m]+1+ +!!n,l.push(e.sCount[m]),e.sCount[m]=o-t,u.push(e.tShift[m]),e.tShift[m]=i-e.bMarks[m];continue}if(p)break;let r=!1;for(let t=0,i=d.length;t<i;t++)if(d[t](e,m,n,!0)){r=!0;break}if(r){e.lineMax=m,e.blkIndent!==0&&(s.push(e.bMarks[m]),c.push(e.bsCount[m]),u.push(e.tShift[m]),l.push(e.sCount[m]),e.sCount[m]-=e.blkIndent);break}s.push(e.bMarks[m]),c.push(e.bsCount[m]),u.push(e.tShift[m]),l.push(e.sCount[m]),e.sCount[m]=-1}let h=e.blkIndent;e.blkIndent=0;let g=e.push(`blockquote_open`,`blockquote`,1);g.markup=`>`;let _=[t,0];g.map=_,e.md.block.tokenize(e,t,m);let v=e.push(`blockquote_close`,`blockquote`,-1);v.markup=`>`,e.lineMax=o,e.parentType=f,_[1]=e.line;for(let n=0;n<u.length;n++)e.bMarks[n+t]=s[n],e.tShift[n+t]=u[n],e.sCount[n+t]=l[n],e.bsCount[n+t]=c[n];return e.blkIndent=h,!0}function Lt(e,t,n,r){let i=e.eMarks[t];if(e.sCount[t]-e.blkIndent>=4)return!1;let a=e.bMarks[t]+e.tShift[t],o=e.src.charCodeAt(a++);if(o!==42&&o!==45&&o!==95)return!1;let s=1;for(;a<i;){let t=e.src.charCodeAt(a++);if(t!==o&&!D(t))return!1;t===o&&s++}if(s<3)return!1;if(r)return!0;e.line=t+1;let c=e.push(`hr`,`hr`,0);return c.map=[t,e.line],c.markup=Array(s+1).join(String.fromCharCode(o)),!0}function Rt(e,t){let n=e.eMarks[t],r=e.bMarks[t]+e.tShift[t],i=e.src.charCodeAt(r++);return i!==42&&i!==45&&i!==43||r<n&&!D(e.src.charCodeAt(r))?-1:r}function zt(e,t){let n=e.bMarks[t]+e.tShift[t],r=e.eMarks[t],i=n;if(i+1>=r)return-1;let a=e.src.charCodeAt(i++);if(a<48||a>57)return-1;for(;;){if(i>=r)return-1;if(a=e.src.charCodeAt(i++),a>=48&&a<=57){if(i-n>=10)return-1;continue}if(a===41||a===46)break;return-1}return i<r&&(a=e.src.charCodeAt(i),!D(a))?-1:i}function Bt(e,t){let n=e.level+2;for(let r=t+2,i=e.tokens.length-2;r<i;r++)e.tokens[r].level===n&&e.tokens[r].type===`paragraph_open`&&(e.tokens[r+2].hidden=!0,e.tokens[r].hidden=!0,r+=2)}function Vt(e,t,n,r){let i,a,o,s,c=t,l=!0;if(e.sCount[c]-e.blkIndent>=4||e.listIndent>=0&&e.sCount[c]-e.listIndent>=4&&e.sCount[c]<e.blkIndent)return!1;let u=!1;r&&e.parentType===`paragraph`&&e.sCount[c]>=e.blkIndent&&(u=!0);let d,f,p;if((p=zt(e,c))>=0){if(d=!0,o=e.bMarks[c]+e.tShift[c],f=Number(e.src.slice(o,p-1)),u&&f!==1)return!1}else if((p=Rt(e,c))>=0)d=!1;else return!1;if(u&&e.skipSpaces(p)>=e.eMarks[c])return!1;if(r)return!0;let m=e.src.charCodeAt(p-1),h=e.tokens.length;d?(s=e.push(`ordered_list_open`,`ol`,1),f!==1&&(s.attrs=[[`start`,f]])):s=e.push(`bullet_list_open`,`ul`,1);let g=[c,0];s.map=g,s.markup=String.fromCharCode(m);let _=!1,v=e.md.block.ruler.getRules(`list`),y=e.parentType;for(e.parentType=`list`;c<n;){a=p,i=e.eMarks[c];let t=e.sCount[c]+p-(e.bMarks[c]+e.tShift[c]),r=t;for(;a<i;){let t=e.src.charCodeAt(a);if(t===9)r+=4-(r+e.bsCount[c])%4;else if(t===32)r++;else break;a++}let u=a,f;f=u>=i?1:r-t,f>4&&(f=1);let h=t+f;s=e.push(`list_item_open`,`li`,1),s.markup=String.fromCharCode(m);let g=[c,0];s.map=g,d&&(s.info=e.src.slice(o,p-1));let y=e.tight,ee=e.tShift[c],te=e.sCount[c],ne=e.listIndent;if(e.listIndent=e.blkIndent,e.blkIndent=h,e.tight=!0,e.tShift[c]=u-e.bMarks[c],e.sCount[c]=r,u>=i&&e.isEmpty(c+1)?e.line=Math.min(e.line+2,n):e.md.block.tokenize(e,c,n,!0),(!e.tight||_)&&(l=!1),_=e.line-c>1&&e.isEmpty(e.line-1),e.blkIndent=e.listIndent,e.listIndent=ne,e.tShift[c]=ee,e.sCount[c]=te,e.tight=y,s=e.push(`list_item_close`,`li`,-1),s.markup=String.fromCharCode(m),c=e.line,g[1]=c,c>=n||e.sCount[c]<e.blkIndent||e.sCount[c]-e.blkIndent>=4)break;let re=!1;for(let t=0,r=v.length;t<r;t++)if(v[t](e,c,n,!0)){re=!0;break}if(re)break;if(d){if(p=zt(e,c),p<0)break;o=e.bMarks[c]+e.tShift[c]}else if(p=Rt(e,c),p<0)break;if(m!==e.src.charCodeAt(p-1))break}return s=d?e.push(`ordered_list_close`,`ol`,-1):e.push(`bullet_list_close`,`ul`,-1),s.markup=String.fromCharCode(m),g[1]=c,e.line=c,e.parentType=y,l&&Bt(e,h),!0}function Ht(e,t,n,r){let i=e.bMarks[t]+e.tShift[t],a=e.eMarks[t],o=t+1;if(e.sCount[t]-e.blkIndent>=4||e.src.charCodeAt(i)!==91)return!1;function s(t){let n=e.lineMax;if(t>=n||e.isEmpty(t))return null;let r=!1;if(e.sCount[t]-e.blkIndent>3&&(r=!0),e.sCount[t]<0&&(r=!0),!r){let r=e.md.block.ruler.getRules(`reference`),i=e.parentType;e.parentType=`reference`;let a=!1;for(let i=0,o=r.length;i<o;i++)if(r[i](e,t,n,!0)){a=!0;break}if(e.parentType=i,a)return null}let i=e.bMarks[t]+e.tShift[t],a=e.eMarks[t];return e.src.slice(i,a+1)}let c=e.src.slice(i,a+1);a=c.length;let l=-1;for(i=1;i<a;i++){let e=c.charCodeAt(i);if(e===91)return!1;if(e===93){l=i;break}else if(e===10){let e=s(o);e!==null&&(c+=e,a=c.length,o++)}else if(e===92&&(i++,i<a&&c.charCodeAt(i)===10)){let e=s(o);e!==null&&(c+=e,a=c.length,o++)}}if(l<0||c.charCodeAt(l+1)!==58)return!1;for(i=l+2;i<a;i++){let e=c.charCodeAt(i);if(e===10){let e=s(o);e!==null&&(c+=e,a=c.length,o++)}else if(!D(e))break}let u=e.md.helpers.parseLinkDestination(c,i,a);if(!u.ok)return!1;let d=e.md.normalizeLink(u.str);if(!e.md.validateLink(d))return!1;i=u.pos;let f=i,p=o,m=i;for(;i<a;i++){let e=c.charCodeAt(i);if(e===10){let e=s(o);e!==null&&(c+=e,a=c.length,o++)}else if(!D(e))break}let h=e.md.helpers.parseLinkTitle(c,i,a);for(;h.can_continue;){let t=s(o);if(t===null)break;c+=t,i=a,a=c.length,o++,h=e.md.helpers.parseLinkTitle(c,i,a,h)}let g;for(i<a&&m!==i&&h.ok?(g=h.str,i=h.pos):(g=``,i=f,o=p);i<a&&D(c.charCodeAt(i));)i++;if(i<a&&c.charCodeAt(i)!==10&&g)for(g=``,i=f,o=p;i<a&&D(c.charCodeAt(i));)i++;if(i<a&&c.charCodeAt(i)!==10)return!1;let _=Ye(c.slice(1,l));return _?r?!0:(e.env.references===void 0&&(e.env.references={}),e.env.references[_]===void 0&&(e.env.references[_]={title:g,href:d}),e.line=o,!0):!1}var Ut=`address.article.aside.base.basefont.blockquote.body.caption.center.col.colgroup.dd.details.dialog.dir.div.dl.dt.fieldset.figcaption.figure.footer.form.frame.frameset.h1.h2.h3.h4.h5.h6.head.header.hr.html.iframe.legend.li.link.main.menu.menuitem.nav.noframes.ol.optgroup.option.p.param.search.section.summary.table.tbody.td.tfoot.th.thead.title.tr.track.ul`.split(`.`),Wt=RegExp(`^(?:<[A-Za-z][A-Za-z0-9\\-]*(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?)*\\s*\\/?>|<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>|<!---?>|<!--(?:[^-]|-[^-]|--[^>])*-->|<[?][\\s\\S]*?[?]>|<![A-Za-z][^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>)`),Gt=RegExp(`^(?:<[A-Za-z][A-Za-z0-9\\-]*(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?)*\\s*\\/?>|<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>)`),I=[[/^<(script|pre|style|textarea)(?=(\s|>|$))/i,/<\/(script|pre|style|textarea)>/i,!0],[/^<!--/,/-->/,!0],[/^<\?/,/\?>/,!0],[/^<![A-Z]/,/>/,!0],[/^<!\[CDATA\[/,/\]\]>/,!0],[RegExp(`^</?(`+Ut.join(`|`)+`)(?=(\\s|/?>|$))`,`i`),/^$/,!0],[RegExp(Gt.source+`\\s*$`),/^$/,!1]];function Kt(e,t,n,r){let i=e.bMarks[t]+e.tShift[t],a=e.eMarks[t];if(e.sCount[t]-e.blkIndent>=4||!e.md.options.html||e.src.charCodeAt(i)!==60)return!1;let o=e.src.slice(i,a),s=0;for(;s<I.length&&!I[s][0].test(o);s++);if(s===I.length)return!1;if(r)return I[s][2];let c=t+1,l=I[s][1].test(``);if(!I[s][1].test(o)){for(;c<n&&!(e.sCount[c]<e.blkIndent&&(l||!e.isEmpty(c)));c++)if(i=e.bMarks[c]+e.tShift[c],a=e.eMarks[c],o=e.src.slice(i,a),I[s][1].test(o)){o.length!==0&&c++;break}}e.line=c;let u=e.push(`html_block`,``,0);return u.map=[t,c],u.content=e.getLines(t,c,e.blkIndent,!0),!0}function qt(e,t,n,r){let i=e.bMarks[t]+e.tShift[t],a=e.eMarks[t];if(e.sCount[t]-e.blkIndent>=4)return!1;let o=e.src.charCodeAt(i);if(o!==35||i>=a)return!1;let s=1;for(o=e.src.charCodeAt(++i);o===35&&i<a&&s<=6;)s++,o=e.src.charCodeAt(++i);if(s>6||i<a&&!D(o))return!1;if(r)return!0;a=e.skipSpacesBack(a,i);let c=e.skipCharsBack(a,35,i);c>i&&D(e.src.charCodeAt(c-1))&&(a=c),e.line=t+1;let l=e.push(`heading_open`,`h`+String(s),1);l.markup=`########`.slice(0,s),l.map=[t,e.line];let u=e.push(`inline`,``,0);u.content=Ze(e.src.slice(i,a)),u.map=[t,e.line],u.children=[];let d=e.push(`heading_close`,`h`+String(s),-1);return d.markup=`########`.slice(0,s),!0}function Jt(e,t,n){let r=e.md.block.ruler.getRules(`paragraph`);if(e.sCount[t]-e.blkIndent>=4)return!1;let i=e.parentType;e.parentType=`paragraph`;let a=0,o,s=t+1;for(;s<n&&!e.isEmpty(s);s++){if(e.sCount[s]-e.blkIndent>3)continue;if(e.sCount[s]>=e.blkIndent){let t=e.bMarks[s]+e.tShift[s],n=e.eMarks[s];if(t<n&&(o=e.src.charCodeAt(t),(o===45||o===61)&&(t=e.skipChars(t,o),t=e.skipSpaces(t),t>=n))){a=o===61?1:2;break}}if(e.sCount[s]<0)continue;let t=!1;for(let i=0,a=r.length;i<a;i++)if(r[i](e,s,n,!0)){t=!0;break}if(t)break}if(!a)return e.parentType=i,!1;let c=Ze(e.getLines(t,s,e.blkIndent,!1));e.line=s+1;let l=e.push(`heading_open`,`h`+String(a),1);l.markup=String.fromCharCode(o),l.map=[t,e.line];let u=e.push(`inline`,``,0);u.content=c,u.map=[t,e.line-1],u.children=[];let d=e.push(`heading_close`,`h`+String(a),-1);return d.markup=String.fromCharCode(o),e.parentType=i,!0}function Yt(e,t,n){let r=e.md.block.ruler.getRules(`paragraph`),i=e.parentType,a=t+1;for(e.parentType=`paragraph`;a<n&&!e.isEmpty(a);a++){if(e.sCount[a]-e.blkIndent>3||e.sCount[a]<0)continue;let t=!1;for(let i=0,o=r.length;i<o;i++)if(r[i](e,a,n,!0)){t=!0;break}if(t)break}let o=Ze(e.getLines(t,a,e.blkIndent,!1));e.line=a;let s=e.push(`paragraph_open`,`p`,1);s.map=[t,e.line];let c=e.push(`inline`,``,0);return c.content=o,c.map=[t,e.line],c.children=[],e.push(`paragraph_close`,`p`,-1),e.parentType=i,!0}var Xt=[[`table`,Nt,[`paragraph`,`reference`]],[`code`,Pt],[`fence`,Ft,[`paragraph`,`reference`,`blockquote`,`list`]],[`blockquote`,It,[`paragraph`,`reference`,`blockquote`,`list`]],[`hr`,Lt,[`paragraph`,`reference`,`blockquote`,`list`]],[`list`,Vt,[`paragraph`,`reference`,`blockquote`]],[`reference`,Ht],[`html_block`,Kt,[`paragraph`,`reference`,`blockquote`]],[`heading`,qt,[`paragraph`,`reference`,`blockquote`]],[`lheading`,Jt],[`paragraph`,Yt]];function Zt(){this.ruler=new N;for(let e=0;e<Xt.length;e++)this.ruler.push(Xt[e][0],Xt[e][1],{alt:(Xt[e][2]||[]).slice()})}Zt.prototype.tokenize=function(e,t,n){let r=this.ruler.getRules(``),i=r.length,a=e.md.options.maxNesting,o=t,s=!1;for(;o<n&&(e.line=o=e.skipEmptyLines(o),!(o>=n||e.sCount[o]<e.blkIndent));){if(e.level>=a){e.line=n;break}let t=e.line,c=!1;for(let a=0;a<i;a++)if(c=r[a](e,o,n,!1),c){if(t>=e.line)throw Error(`block rule didn't increment state.line`);break}if(!c)throw Error(`none of the block rules matched`);e.tight=!s,e.isEmpty(e.line-1)&&(s=!0),o=e.line,o<n&&e.isEmpty(o)&&(s=!0,o++,e.line=o)}},Zt.prototype.parse=function(e,t,n,r){if(!e)return;let i=new this.State(e,t,n,r);this.tokenize(i,i.line,i.lineMax)},Zt.prototype.State=F;function L(e,t,n,r){this.src=e,this.env=n,this.md=t,this.tokens=r,this.tokens_meta=Array(r.length),this.pos=0,this.posMax=this.src.length,this.level=0,this.pending=``,this.pendingLevel=0,this.cache={},this.delimiters=[],this._prev_delimiters=[],this.backticks={},this.backticksScanned=!1,this.linkLevel=0}L.prototype.pushPending=function(){let e=new P(`text`,``,0);return e.content=this.pending,e.level=this.pendingLevel,this.tokens.push(e),this.pending=``,e},L.prototype.push=function(e,t,n){this.pending&&this.pushPending();let r=new P(e,t,n),i=null;return n<0&&(this.level--,this.delimiters=this._prev_delimiters.pop()),r.level=this.level,n>0&&(this.level++,this._prev_delimiters.push(this.delimiters),this.delimiters=[],i={delimiters:this.delimiters}),this.pendingLevel=this.level,this.tokens.push(r),this.tokens_meta.push(i),r},L.prototype.scanDelims=function(e,t){let n=this.posMax,r=this.src.charCodeAt(e),i;if(e===0)i=32;else if(e===1)i=this.src.charCodeAt(0),(i&63488)==55296&&(i=65533);else if(i=this.src.charCodeAt(e-1),(i&64512)==56320){let t=this.src.charCodeAt(e-2);i=(t&64512)==55296?65536+(t-55296<<10)+(i-56320):65533}else (i&64512)==55296&&(i=65533);let a=e;for(;a<n&&this.src.charCodeAt(a)===r;)a++;let o=a-e,s=a<n?this.src.charCodeAt(a):32;if((s&64512)==55296){let e=this.src.charCodeAt(a+1);s=(e&64512)==56320?65536+(s-55296<<10)+(e-56320):65533}else (s&64512)==56320&&(s=65533);let c=A(i)||k(i),l=A(s)||k(s),u=O(i),d=O(s),f=!d&&(!l||u||c),p=!u&&(!c||d||l);return{can_open:f&&(t||!p||c),can_close:p&&(t||!f||l),length:o}},L.prototype.Token=P;function Qt(e){switch(e){case 10:case 33:case 35:case 36:case 37:case 38:case 42:case 43:case 45:case 58:case 60:case 61:case 62:case 64:case 91:case 92:case 93:case 94:case 95:case 96:case 123:case 125:case 126:return!0;default:return!1}}function $t(e,t){let n=e.pos;for(;n<e.posMax&&!Qt(e.src.charCodeAt(n));)n++;return n===e.pos?!1:(t||(e.pending+=e.src.slice(e.pos,n)),e.pos=n,!0)}var en=/(?:^|[^a-z0-9.+-])([a-z][a-z0-9.+-]*)$/i;function tn(e,t){if(!e.md.options.linkify||e.linkLevel>0)return!1;let n=e.pos,r=e.posMax;if(n+3>r||e.src.charCodeAt(n)!==58||e.src.charCodeAt(n+1)!==47||e.src.charCodeAt(n+2)!==47)return!1;let i=e.pending.match(en);if(!i)return!1;let a=i[1],o=e.md.linkify.matchAtStart(e.src.slice(n-a.length));if(!o)return!1;let s=o.url;if(s.length<=a.length)return!1;let c=s.length;for(;c>0&&s.charCodeAt(c-1)===42;)c--;c!==s.length&&(s=s.slice(0,c));let l=e.md.normalizeLink(s);if(!e.md.validateLink(l))return!1;if(!t){e.pending=e.pending.slice(0,-a.length);let t=e.push(`link_open`,`a`,1);t.attrs=[[`href`,l]],t.markup=`linkify`,t.info=`auto`;let n=e.push(`text`,``,0);n.content=e.md.normalizeLinkText(s);let r=e.push(`link_close`,`a`,-1);r.markup=`linkify`,r.info=`auto`}return e.pos+=s.length-a.length,!0}function nn(e,t){let n=e.pos;if(e.src.charCodeAt(n)!==10)return!1;let r=e.pending.length-1,i=e.posMax;if(!t)if(r>=0&&e.pending.charCodeAt(r)===32)if(r>=1&&e.pending.charCodeAt(r-1)===32){let t=r-1;for(;t>=1&&e.pending.charCodeAt(t-1)===32;)t--;e.pending=e.pending.slice(0,t),e.push(`hardbreak`,`br`,0)}else e.pending=e.pending.slice(0,-1),e.push(`softbreak`,`br`,0);else e.push(`softbreak`,`br`,0);for(n++;n<i&&D(e.src.charCodeAt(n));)n++;return e.pos=n,!0}var rn=[];for(let e=0;e<256;e++)rn.push(0);`\\!"#$%&'()*+,./:;<=>?@[]^_\`{|}~-`.split(``).forEach(function(e){rn[e.charCodeAt(0)]=1});function an(e,t){let n=e.pos,r=e.posMax;if(e.src.charCodeAt(n)!==92||(n++,n>=r))return!1;let i=e.src.charCodeAt(n);if(i===10){for(t||e.push(`hardbreak`,`br`,0),n++;n<r&&(i=e.src.charCodeAt(n),D(i));)n++;return e.pos=n,!0}let a=e.src[n];if(i>=55296&&i<=56319&&n+1<r){let t=e.src.charCodeAt(n+1);t>=56320&&t<=57343&&(a+=e.src[n+1],n++)}let o=`\\`+a;if(!t){let t=e.push(`text_special`,``,0);i<256&&rn[i]!==0?t.content=a:t.content=o,t.markup=o,t.info=`escape`}return e.pos=n+1,!0}function on(e,t){let n=e.pos;if(e.src.charCodeAt(n)!==96)return!1;let r=n;n++;let i=e.posMax;for(;n<i&&e.src.charCodeAt(n)===96;)n++;let a=e.src.slice(r,n),o=a.length;if(e.backticksScanned&&(e.backticks[o]||0)<=r)return t||(e.pending+=a),e.pos+=o,!0;let s=n,c;for(;(c=e.src.indexOf("`",s))!==-1;){for(s=c+1;s<i&&e.src.charCodeAt(s)===96;)s++;let r=s-c;if(r===o){if(!t){let t=e.push(`code_inline`,`code`,0);t.markup=a,t.content=e.src.slice(n,c).replace(/\n/g,` `).replace(/^ (.+) $/,`$1`)}return e.pos=s,!0}e.backticks[r]=c}return e.backticksScanned=!0,t||(e.pending+=a),e.pos+=o,!0}function sn(e,t){let n=e.pos,r=e.src.charCodeAt(n);if(t||r!==126)return!1;let i=e.scanDelims(e.pos,!0),a=i.length,o=String.fromCharCode(r);if(a<2)return!1;let s;a%2&&(s=e.push(`text`,``,0),s.content=o,a--);for(let t=0;t<a;t+=2)s=e.push(`text`,``,0),s.content=o+o,e.delimiters.push({marker:r,length:0,token:e.tokens.length-1,end:-1,open:i.can_open,close:i.can_close});return e.pos+=i.length,!0}function cn(e,t){let n,r=[],i=t.length;for(let a=0;a<i;a++){let i=t[a];if(i.marker!==126||i.end===-1)continue;let o=t[i.end];n=e.tokens[i.token],n.type=`s_open`,n.tag=`s`,n.nesting=1,n.markup=`~~`,n.content=``,n=e.tokens[o.token],n.type=`s_close`,n.tag=`s`,n.nesting=-1,n.markup=`~~`,n.content=``,e.tokens[o.token-1].type===`text`&&e.tokens[o.token-1].content===`~`&&r.push(o.token-1)}for(;r.length;){let t=r.pop(),i=t+1;for(;i<e.tokens.length&&e.tokens[i].type===`s_close`;)i++;i--,t!==i&&(n=e.tokens[i],e.tokens[i]=e.tokens[t],e.tokens[t]=n)}}function ln(e){let t=e.tokens_meta,n=e.tokens_meta.length;cn(e,e.delimiters);for(let r=0;r<n;r++)t[r]&&t[r].delimiters&&cn(e,t[r].delimiters)}var un={tokenize:sn,postProcess:ln};function dn(e,t){let n=e.pos,r=e.src.charCodeAt(n);if(t||r!==95&&r!==42)return!1;let i=e.scanDelims(e.pos,r===42);for(let t=0;t<i.length;t++){let t=e.push(`text`,``,0);t.content=String.fromCharCode(r),e.delimiters.push({marker:r,length:i.length,token:e.tokens.length-1,end:-1,open:i.can_open,close:i.can_close})}return e.pos+=i.length,!0}function fn(e,t){let n=t.length;for(let r=n-1;r>=0;r--){let n=t[r];if(n.marker!==95&&n.marker!==42||n.end===-1)continue;let i=t[n.end],a=r>0&&t[r-1].end===n.end+1&&t[r-1].marker===n.marker&&t[r-1].token===n.token-1&&t[n.end+1].token===i.token+1,o=String.fromCharCode(n.marker),s=e.tokens[n.token];s.type=a?`strong_open`:`em_open`,s.tag=a?`strong`:`em`,s.nesting=1,s.markup=a?o+o:o,s.content=``;let c=e.tokens[i.token];c.type=a?`strong_close`:`em_close`,c.tag=a?`strong`:`em`,c.nesting=-1,c.markup=a?o+o:o,c.content=``,a&&(e.tokens[t[r-1].token].content=``,e.tokens[t[n.end+1].token].content=``,r--)}}function pn(e){let t=e.tokens_meta,n=e.tokens_meta.length;fn(e,e.delimiters);for(let r=0;r<n;r++)t[r]&&t[r].delimiters&&fn(e,t[r].delimiters)}var mn={tokenize:dn,postProcess:pn};function hn(e,t){let n,r,i,a,o=``,s=``,c=e.pos,l=!0;if(e.src.charCodeAt(e.pos)!==91)return!1;let u=e.pos,d=e.posMax,f=e.pos+1,p=e.md.helpers.parseLinkLabel(e,e.pos,!0);if(p<0)return!1;let m=p+1;if(m<d&&e.src.charCodeAt(m)===40){for(l=!1,m++;m<d&&(n=e.src.charCodeAt(m),!(!D(n)&&n!==10));m++);if(m>=d)return!1;if(c=m,i=e.md.helpers.parseLinkDestination(e.src,m,e.posMax),i.ok){for(o=e.md.normalizeLink(i.str),e.md.validateLink(o)?m=i.pos:o=``,c=m;m<d&&(n=e.src.charCodeAt(m),!(!D(n)&&n!==10));m++);if(i=e.md.helpers.parseLinkTitle(e.src,m,e.posMax),m<d&&c!==m&&i.ok)for(s=i.str,m=i.pos;m<d&&(n=e.src.charCodeAt(m),!(!D(n)&&n!==10));m++);}(m>=d||e.src.charCodeAt(m)!==41)&&(l=!0),m++}if(l){if(e.env.references===void 0)return!1;if(m<d&&e.src.charCodeAt(m)===91?(c=m+1,m=e.md.helpers.parseLinkLabel(e,m),m>=0?r=e.src.slice(c,m++):m=p+1):m=p+1,r||=e.src.slice(f,p),a=e.env.references[Ye(r)],!a)return e.pos=u,!1;o=a.href,s=a.title}if(!t){e.pos=f,e.posMax=p;let t=e.push(`link_open`,`a`,1),n=[[`href`,o]];t.attrs=n,s&&n.push([`title`,s]),e.linkLevel++,e.md.inline.tokenize(e),e.linkLevel--,e.push(`link_close`,`a`,-1)}return e.pos=m,e.posMax=d,!0}function gn(e,t){let n,r,i,a,o,s,c,l,u=``,d=e.pos,f=e.posMax;if(e.src.charCodeAt(e.pos)!==33||e.src.charCodeAt(e.pos+1)!==91)return!1;let p=e.pos+2,m=e.md.helpers.parseLinkLabel(e,e.pos+1,!1);if(m<0)return!1;if(a=m+1,a<f&&e.src.charCodeAt(a)===40){for(a++;a<f&&(n=e.src.charCodeAt(a),!(!D(n)&&n!==10));a++);if(a>=f)return!1;for(l=a,s=e.md.helpers.parseLinkDestination(e.src,a,e.posMax),s.ok&&(u=e.md.normalizeLink(s.str),e.md.validateLink(u)?a=s.pos:u=``),l=a;a<f&&(n=e.src.charCodeAt(a),!(!D(n)&&n!==10));a++);if(s=e.md.helpers.parseLinkTitle(e.src,a,e.posMax),a<f&&l!==a&&s.ok)for(c=s.str,a=s.pos;a<f&&(n=e.src.charCodeAt(a),!(!D(n)&&n!==10));a++);else c=``;if(a>=f||e.src.charCodeAt(a)!==41)return e.pos=d,!1;a++}else{if(e.env.references===void 0)return!1;if(a<f&&e.src.charCodeAt(a)===91?(l=a+1,a=e.md.helpers.parseLinkLabel(e,a),a>=0?i=e.src.slice(l,a++):a=m+1):a=m+1,i||=e.src.slice(p,m),o=e.env.references[Ye(i)],!o)return e.pos=d,!1;u=o.href,c=o.title}if(!t){r=e.src.slice(p,m);let t=[];e.md.inline.parse(r,e.md,e.env,t);let n=e.push(`image`,`img`,0),i=[[`src`,u],[`alt`,``]];n.attrs=i,n.children=t,n.content=r,c&&i.push([`title`,c])}return e.pos=a,e.posMax=f,!0}var _n=/^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/,vn=/^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):([^<>\x00-\x20]*)$/;function yn(e,t){let n=e.pos;if(e.src.charCodeAt(n)!==60)return!1;let r=e.pos,i=e.posMax;for(;;){if(++n>=i)return!1;let t=e.src.charCodeAt(n);if(t===60)return!1;if(t===62)break}let a=e.src.slice(r+1,n);if(vn.test(a)){let n=e.md.normalizeLink(a);if(!e.md.validateLink(n))return!1;if(!t){let t=e.push(`link_open`,`a`,1);t.attrs=[[`href`,n]],t.markup=`autolink`,t.info=`auto`;let r=e.push(`text`,``,0);r.content=e.md.normalizeLinkText(a);let i=e.push(`link_close`,`a`,-1);i.markup=`autolink`,i.info=`auto`}return e.pos+=a.length+2,!0}if(_n.test(a)){let n=e.md.normalizeLink(`mailto:`+a);if(!e.md.validateLink(n))return!1;if(!t){let t=e.push(`link_open`,`a`,1);t.attrs=[[`href`,n]],t.markup=`autolink`,t.info=`auto`;let r=e.push(`text`,``,0);r.content=e.md.normalizeLinkText(a);let i=e.push(`link_close`,`a`,-1);i.markup=`autolink`,i.info=`auto`}return e.pos+=a.length+2,!0}return!1}function bn(e){return/^<a[>\s]/i.test(e)}function xn(e){return/^<\/a\s*>/i.test(e)}function Sn(e){let t=e|32;return t>=97&&t<=122}function Cn(e,t){if(!e.md.options.html)return!1;let n=e.posMax,r=e.pos;if(e.src.charCodeAt(r)!==60||r+2>=n)return!1;let i=e.src.charCodeAt(r+1);if(i!==33&&i!==63&&i!==47&&!Sn(i))return!1;let a=e.src.slice(r).match(Wt);if(!a)return!1;if(!t){let t=e.push(`html_inline`,``,0);t.content=a[0],bn(t.content)&&e.linkLevel++,xn(t.content)&&e.linkLevel--}return e.pos+=a[0].length,!0}var wn=/^&#((?:x[a-f0-9]{1,6}|[0-9]{1,7}));/i,Tn=/^&([a-z][a-z0-9]{1,31});/i;function En(e,t){let n=e.pos,r=e.posMax;if(e.src.charCodeAt(n)!==38||n+1>=r)return!1;if(e.src.charCodeAt(n+1)===35){let r=e.src.slice(n).match(wn);if(r){if(!t){let t=r[1][0].toLowerCase()===`x`?parseInt(r[1].slice(1),16):parseInt(r[1],10),n=e.push(`text_special`,``,0);n.content=Ie(t)?w(t):w(65533),n.markup=r[0],n.info=`entity`}return e.pos+=r[0].length,!0}}else{let r=e.src.slice(n).match(Tn);if(r){let n=Oe(r[0]);if(n!==r[0]){if(!t){let t=e.push(`text_special`,``,0);t.content=n,t.markup=r[0],t.info=`entity`}return e.pos+=r[0].length,!0}}}return!1}function Dn(e){let t={},n=e.length;if(!n)return;let r=0,i=-2,a=[];for(let o=0;o<n;o++){let n=e[o];if(a.push(0),(e[r].marker!==n.marker||i!==n.token-1)&&(r=o),i=n.token,n.length=n.length||0,!n.close)continue;t.hasOwnProperty(n.marker)||(t[n.marker]=[-1,-1,-1,-1,-1,-1]);let s=t[n.marker][(n.open?3:0)+n.length%3],c=r-a[r]-1,l=c;for(;c>s;c-=a[c]+1){let t=e[c];if(t.marker===n.marker&&t.open&&t.end<0){let r=!1;if((t.close||n.open)&&(t.length+n.length)%3==0&&(t.length%3!=0||n.length%3!=0)&&(r=!0),!r){let r=c>0&&!e[c-1].open?a[c-1]+1:0;a[o]=o-c+r,a[c]=r,n.open=!1,t.end=o,t.close=!1,l=-1,i=-2;break}}}l!==-1&&(t[n.marker][(n.open?3:0)+(n.length||0)%3]=l)}}function On(e){let t=e.tokens_meta,n=e.tokens_meta.length;Dn(e.delimiters);for(let e=0;e<n;e++)t[e]&&t[e].delimiters&&Dn(t[e].delimiters)}function kn(e){let t,n,r=0,i=e.tokens,a=e.tokens.length;for(t=n=0;t<a;t++)i[t].nesting<0&&r--,i[t].level=r,i[t].nesting>0&&r++,i[t].type===`text`&&t+1<a&&i[t+1].type===`text`?i[t+1].content=i[t].content+i[t+1].content:(t!==n&&(i[n]=i[t]),n++);t!==n&&(i.length=n)}var An=[[`text`,$t],[`linkify`,tn],[`newline`,nn],[`escape`,an],[`backticks`,on],[`strikethrough`,un.tokenize],[`emphasis`,mn.tokenize],[`link`,hn],[`image`,gn],[`autolink`,yn],[`html_inline`,Cn],[`entity`,En]],jn=[[`balance_pairs`,On],[`strikethrough`,un.postProcess],[`emphasis`,mn.postProcess],[`fragments_join`,kn]];function R(){this.ruler=new N;for(let e=0;e<An.length;e++)this.ruler.push(An[e][0],An[e][1]);this.ruler2=new N;for(let e=0;e<jn.length;e++)this.ruler2.push(jn[e][0],jn[e][1])}R.prototype.skipToken=function(e){let t=e.pos,n=this.ruler.getRules(``),r=n.length,i=e.md.options.maxNesting,a=e.cache;if(a[t]!==void 0){e.pos=a[t];return}let o=!1;if(e.level<i){for(let i=0;i<r;i++)if(e.level++,o=n[i](e,!0),e.level--,o){if(t>=e.pos)throw Error(`inline rule didn't increment state.pos`);break}}else e.pos=e.posMax;o||e.pos++,a[t]=e.pos},R.prototype.tokenize=function(e){let t=this.ruler.getRules(``),n=t.length,r=e.posMax,i=e.md.options.maxNesting;for(;e.pos<r;){let a=e.pos,o=!1;if(e.level<i){for(let r=0;r<n;r++)if(o=t[r](e,!1),o){if(a>=e.pos)throw Error(`inline rule didn't increment state.pos`);break}}if(o){if(e.pos>=r)break;continue}e.pending+=e.src[e.pos++]}e.pending&&e.pushPending()},R.prototype.parse=function(e,t,n,r){let i=new this.State(e,t,n,r);this.tokenize(i);let a=this.ruler2.getRules(``),o=a.length;for(let e=0;e<o;e++)a[e](i)},R.prototype.State=L;function Mn(e){let t={};return e||={},t.src_Any=oe.source,t.src_Cc=se.source,t.src_Z=de.source,t.src_P=le.source,t.src_ZPCc=[t.src_Z,t.src_P,t.src_Cc].join(`|`),t.src_ZCc=[t.src_Z,t.src_Cc].join(`|`),t.src_pseudo_letter=`(?:(?![><｜]|`+t.src_ZPCc+`)`+t.src_Any+`)`,t.src_ip4=`(?:(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)`,t.src_auth=`(?:(?:(?!`+t.src_ZCc+`|[@/\\[\\]()]).)+@)?`,t.src_port=`(?::(?:6(?:[0-4]\\d{3}|5(?:[0-4]\\d{2}|5(?:[0-2]\\d|3[0-5])))|[1-5]?\\d{1,4}))?`,t.src_host_terminator=`(?=$|[><｜]|`+t.src_ZPCc+`)(?!`+(e[`---`]?`-(?!--)|`:`-|`)+`_|:\\d|\\.-|\\.(?!$|`+t.src_ZPCc+`))`,t.src_path=`(?:[/?#](?:(?!`+t.src_ZCc+`|[><｜]|[()[\\]{}.,"'?!\\-;]).|\\[(?:(?!`+t.src_ZCc+`|\\]).)*\\]|\\((?:(?!`+t.src_ZCc+`|[)]).)*\\)|\\{(?:(?!`+t.src_ZCc+`|[}]).)*\\}|\\"(?:(?!`+t.src_ZCc+`|["]).)+\\"|\\'(?:(?!`+t.src_ZCc+`|[']).)+\\'|\\'(?=`+t.src_pseudo_letter+`|[-])|\\.{2,}[a-zA-Z0-9%/&]|\\.(?!`+t.src_ZCc+`|[.]|$)|`+(e[`---`]?`\\-(?!--(?:[^-]|$))(?:-*)|`:`\\-+|`)+`,(?!`+t.src_ZCc+`|$)|;(?!`+t.src_ZCc+`|$)|\\!+(?!`+t.src_ZCc+`|[!]|$)|\\?(?!`+t.src_ZCc+`|[?]|$))+|\\/)?`,t.src_email_name=`[\\-;:&=\\+\\$,\\.a-zA-Z0-9_][\\-;:&=\\+\\$,\\"\\.a-zA-Z0-9_]*`,t.src_xn=`xn--[a-z0-9\\-]{1,59}`,t.src_domain_root=`(?:`+t.src_xn+`|`+t.src_pseudo_letter+`{1,63})`,t.src_domain=`(?:`+t.src_xn+`|(?:`+t.src_pseudo_letter+`)|(?:`+t.src_pseudo_letter+`(?:-|`+t.src_pseudo_letter+`){0,61}`+t.src_pseudo_letter+`))`,t.src_host=`(?:(?:(?:(?:`+t.src_domain+`)\\.)*`+t.src_domain+`))`,t.tpl_host_fuzzy=`(?:`+t.src_ip4+`|(?:(?:(?:`+t.src_domain+`)\\.)+(?:%TLDS%)))`,t.tpl_host_no_ip_fuzzy=`(?:(?:(?:`+t.src_domain+`)\\.)+(?:%TLDS%))`,t.src_host_strict=t.src_host+t.src_host_terminator,t.tpl_host_fuzzy_strict=t.tpl_host_fuzzy+t.src_host_terminator,t.src_host_port_strict=t.src_host+t.src_port+t.src_host_terminator,t.tpl_host_port_fuzzy_strict=t.tpl_host_fuzzy+t.src_port+t.src_host_terminator,t.tpl_host_port_no_ip_fuzzy_strict=t.tpl_host_no_ip_fuzzy+t.src_port+t.src_host_terminator,t.tpl_host_fuzzy_test=`localhost|www\\.|\\.\\d{1,3}\\.|(?:\\.(?:%TLDS%)(?:`+t.src_ZPCc+`|>|$))`,t.tpl_email_fuzzy=`(^|[><｜]|"|\\(|`+t.src_ZCc+`)(`+t.src_email_name+`@`+t.tpl_host_fuzzy_strict+`)`,t.tpl_link_fuzzy="(^|(?![.:/\\-_@])(?:[$+<=>^`|｜]|"+t.src_ZPCc+"))((?![$+<=>^`|｜])"+t.tpl_host_port_fuzzy_strict+t.src_path+`)`,t.tpl_link_no_ip_fuzzy="(^|(?![.:/\\-_@])(?:[$+<=>^`|｜]|"+t.src_ZPCc+"))((?![$+<=>^`|｜])"+t.tpl_host_port_no_ip_fuzzy_strict+t.src_path+`)`,t}function Nn(e){return Array.prototype.slice.call(arguments,1).forEach(function(t){t&&Object.keys(t).forEach(function(n){e[n]=t[n]})}),e}function Pn(e){return Object.prototype.toString.call(e)}function Fn(e){return Pn(e)===`[object String]`}function In(e){return Pn(e)===`[object Object]`}function Ln(e){return Pn(e)===`[object RegExp]`}function Rn(e){return Pn(e)===`[object Function]`}function zn(e){return e.replace(/[.?*+^$[\]\\(){}|-]/g,`\\$&`)}var Bn={fuzzyLink:!0,fuzzyEmail:!0,fuzzyIP:!1};function Vn(e){return Object.keys(e||{}).reduce(function(e,t){return e||Bn.hasOwnProperty(t)},!1)}var Hn={"http:":{validate:function(e,t,n){let r=e.slice(t);return n.re.http||(n.re.http=RegExp(`^\\/\\/`+n.re.src_auth+n.re.src_host_port_strict+n.re.src_path,`i`)),n.re.http.test(r)?r.match(n.re.http)[0].length:0}},"https:":`http:`,"ftp:":`http:`,"//":{validate:function(e,t,n){let r=e.slice(t);return n.re.no_http||(n.re.no_http=RegExp(`^`+n.re.src_auth+`(?:localhost|(?:(?:`+n.re.src_domain+`)\\.)+`+n.re.src_domain_root+`)`+n.re.src_port+n.re.src_host_terminator+n.re.src_path,`i`)),n.re.no_http.test(r)?t>=3&&e[t-3]===`:`||t>=3&&e[t-3]===`/`?0:r.match(n.re.no_http)[0].length:0}},"mailto:":{validate:function(e,t,n){let r=e.slice(t);return n.re.mailto||(n.re.mailto=RegExp(`^`+n.re.src_email_name+`@`+n.re.src_host_strict,`i`)),n.re.mailto.test(r)?r.match(n.re.mailto)[0].length:0}}},Un=`a[cdefgilmnoqrstuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|m[acdeghklmnopqrstuvwxyz]|n[acefgilopruz]|om|p[aefghklmnrstwy]|qa|r[eosuw]|s[abcdeghijklmnortuvxyz]|t[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]`,Wn=`biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф`.split(`|`);function Gn(e){return function(t,n){let r=t.slice(n);return e.test(r)?r.match(e)[0].length:0}}function Kn(){return function(e,t){t.normalize(e)}}function qn(e){let t=e.re=Mn(e.__opts__),n=e.__tlds__.slice();e.onCompile(),e.__tlds_replaced__||n.push(Un),n.push(t.src_xn),t.src_tlds=n.join(`|`);function r(e){return e.replace(`%TLDS%`,t.src_tlds)}t.email_fuzzy=RegExp(r(t.tpl_email_fuzzy),`i`),t.email_fuzzy_global=RegExp(r(t.tpl_email_fuzzy),`ig`),t.link_fuzzy=RegExp(r(t.tpl_link_fuzzy),`i`),t.link_fuzzy_global=RegExp(r(t.tpl_link_fuzzy),`ig`),t.link_no_ip_fuzzy=RegExp(r(t.tpl_link_no_ip_fuzzy),`i`),t.link_no_ip_fuzzy_global=RegExp(r(t.tpl_link_no_ip_fuzzy),`ig`),t.host_fuzzy_test=RegExp(r(t.tpl_host_fuzzy_test),`i`);let i=[];e.__compiled__={};function a(e,t){throw Error(`(LinkifyIt) Invalid schema "`+e+`": `+t)}Object.keys(e.__schemas__).forEach(function(t){let n=e.__schemas__[t];if(n===null)return;let r={validate:null,link:null};if(e.__compiled__[t]=r,In(n)){Ln(n.validate)?r.validate=Gn(n.validate):Rn(n.validate)?r.validate=n.validate:a(t,n),Rn(n.normalize)?r.normalize=n.normalize:n.normalize?a(t,n):r.normalize=Kn();return}if(Fn(n)){i.push(t);return}a(t,n)}),i.forEach(function(t){e.__compiled__[e.__schemas__[t]]&&(e.__compiled__[t].validate=e.__compiled__[e.__schemas__[t]].validate,e.__compiled__[t].normalize=e.__compiled__[e.__schemas__[t]].normalize)}),e.__compiled__[``]={validate:null,normalize:Kn()};let o=Object.keys(e.__compiled__).filter(function(t){return t.length>0&&e.__compiled__[t]}).map(zn).join(`|`);e.re.schema_test=RegExp(`(^|(?!_)(?:[><｜]|`+t.src_ZPCc+`))(`+o+`)`,`i`),e.re.schema_search=RegExp(`(^|(?!_)(?:[><｜]|`+t.src_ZPCc+`))(`+o+`)`,`ig`),e.re.schema_at_start=RegExp(`^`+e.re.schema_search.source,`i`),e.re.pretest=RegExp(`(`+e.re.schema_test.source+`)|(`+e.re.host_fuzzy_test.source+`)|@`,`i`)}function Jn(e,t,n,r){let i=e.slice(n,r);this.schema=t.toLowerCase(),this.index=n,this.lastIndex=r,this.raw=i,this.text=i,this.url=i}function z(e,t){if(!(this instanceof z))return new z(e,t);t||Vn(e)&&(t=e,e={}),this.__opts__=Nn({},Bn,t),this.__schemas__=Nn({},Hn,e),this.__compiled__={},this.__tlds__=Wn,this.__tlds_replaced__=!1,this.re={},qn(this)}z.prototype.add=function(e,t){return this.__schemas__[e]=t,qn(this),this},z.prototype.set=function(e){return this.__opts__=Nn(this.__opts__,e),this},z.prototype.test=function(e){if(!e.length)return!1;let t,n;if(this.re.schema_test.test(e)){for(n=this.re.schema_search,n.lastIndex=0;(t=n.exec(e))!==null;)if(this.testSchemaAt(e,t[2],n.lastIndex))return!0}return!!(this.__opts__.fuzzyLink&&this.__compiled__[`http:`]&&e.search(this.re.host_fuzzy_test)>=0&&e.match(this.__opts__.fuzzyIP?this.re.link_fuzzy:this.re.link_no_ip_fuzzy)!==null||this.__opts__.fuzzyEmail&&this.__compiled__[`mailto:`]&&e.indexOf(`@`)>=0&&e.match(this.re.email_fuzzy)!==null)},z.prototype.pretest=function(e){return this.re.pretest.test(e)},z.prototype.testSchemaAt=function(e,t,n){return this.__compiled__[t.toLowerCase()]?this.__compiled__[t.toLowerCase()].validate(e,n,this):0},z.prototype.match=function(e){let t=[],n=[],r=[],i=[],a,o,s;function c(e,t){return e?t?e.index===t.index?e.lastIndex>=t.lastIndex?e:t:e.index<t.index?e:t:e:t}if(!e.length)return null;if(this.re.schema_test.test(e))for(s=this.re.schema_search,s.lastIndex=0;(a=s.exec(e))!==null;)o=this.testSchemaAt(e,a[2],s.lastIndex),o&&n.push({schema:a[2],index:a.index+a[1].length,lastIndex:a.index+a[0].length+o});if(this.__opts__.fuzzyLink&&this.__compiled__[`http:`])for(s=this.__opts__.fuzzyIP?this.re.link_fuzzy_global:this.re.link_no_ip_fuzzy_global,s.lastIndex=0;(a=s.exec(e))!==null;)r.push({schema:``,index:a.index+a[1].length,lastIndex:a.index+a[0].length});if(this.__opts__.fuzzyEmail&&this.__compiled__[`mailto:`])for(s=this.re.email_fuzzy_global,s.lastIndex=0;(a=s.exec(e))!==null;)i.push({schema:`mailto:`,index:a.index+a[1].length,lastIndex:a.index+a[0].length});let l=[0,0,0],u=0;for(;;){let a=[n[l[0]],i[l[1]],r[l[2]]],o=c(c(a[0],a[1]),a[2]);if(!o)break;if(o===a[0]?l[0]++:o===a[1]?l[1]++:l[2]++,o.index<u)continue;let s=new Jn(e,o.schema,o.index,o.lastIndex);this.__compiled__[s.schema].normalize(s,this),t.push(s),u=o.lastIndex}return t.length?t:null},z.prototype.matchAtStart=function(e){if(!e.length)return null;let t=this.re.schema_at_start.exec(e);if(!t)return null;let n=this.testSchemaAt(e,t[2],t[0].length);if(!n)return null;let r=new Jn(e,t[2],t.index+t[1].length,t.index+t[0].length+n);return this.__compiled__[r.schema].normalize(r,this),r},z.prototype.tlds=function(e,t){return e=Array.isArray(e)?e:[e],t?(this.__tlds__=this.__tlds__.concat(e).sort().filter(function(e,t,n){return e!==n[t-1]}).reverse(),qn(this),this):(this.__tlds__=e.slice(),this.__tlds_replaced__=!0,qn(this),this)},z.prototype.normalize=function(e){e.schema||(e.url=`http://`+e.url),e.schema===`mailto:`&&!/^mailto:/i.test(e.url)&&(e.url=`mailto:`+e.url)},z.prototype.onCompile=function(){};var B=2147483647,V=36,Yn=1,Xn=26,Zn=38,Qn=700,$n=72,er=128,tr=`-`,nr=/^xn--/,rr=/[^\0-\x7F]/,ir=/[\x2E\u3002\uFF0E\uFF61]/g,ar={overflow:`Overflow: input needs wider integers to process`,"not-basic":`Illegal input >= 0x80 (not a basic code point)`,"invalid-input":`Invalid input`},or=V-Yn,H=Math.floor,sr=String.fromCharCode;function U(e){throw RangeError(ar[e])}function cr(e,t){let n=[],r=e.length;for(;r--;)n[r]=t(e[r]);return n}function lr(e,t){let n=e.split(`@`),r=``;n.length>1&&(r=n[0]+`@`,e=n[1]),e=e.replace(ir,`.`);let i=cr(e.split(`.`),t).join(`.`);return r+i}function ur(e){let t=[],n=0,r=e.length;for(;n<r;){let i=e.charCodeAt(n++);if(i>=55296&&i<=56319&&n<r){let r=e.charCodeAt(n++);(r&64512)==56320?t.push(((i&1023)<<10)+(r&1023)+65536):(t.push(i),n--)}else t.push(i)}return t}var dr=e=>String.fromCodePoint(...e),fr=function(e){return e>=48&&e<58?26+(e-48):e>=65&&e<91?e-65:e>=97&&e<123?e-97:V},pr=function(e,t){return e+22+75*(e<26)-((t!=0)<<5)},mr=function(e,t,n){let r=0;for(e=n?H(e/Qn):e>>1,e+=H(e/t);e>455;r+=V)e=H(e/or);return H(r+36*e/(e+Zn))},hr=function(e){let t=[],n=e.length,r=0,i=er,a=$n,o=e.lastIndexOf(tr);o<0&&(o=0);for(let n=0;n<o;++n)e.charCodeAt(n)>=128&&U(`not-basic`),t.push(e.charCodeAt(n));for(let s=o>0?o+1:0;s<n;){let o=r;for(let t=1,i=V;;i+=V){s>=n&&U(`invalid-input`);let o=fr(e.charCodeAt(s++));o>=V&&U(`invalid-input`),o>H((B-r)/t)&&U(`overflow`),r+=o*t;let c=i<=a?Yn:i>=a+Xn?Xn:i-a;if(o<c)break;let l=V-c;t>H(B/l)&&U(`overflow`),t*=l}let c=t.length+1;a=mr(r-o,c,o==0),H(r/c)>B-i&&U(`overflow`),i+=H(r/c),r%=c,t.splice(r++,0,i)}return String.fromCodePoint(...t)},gr=function(e){let t=[];e=ur(e);let n=e.length,r=er,i=0,a=$n;for(let n of e)n<128&&t.push(sr(n));let o=t.length,s=o;for(o&&t.push(tr);s<n;){let n=B;for(let t of e)t>=r&&t<n&&(n=t);let c=s+1;n-r>H((B-i)/c)&&U(`overflow`),i+=(n-r)*c,r=n;for(let n of e)if(n<r&&++i>B&&U(`overflow`),n===r){let e=i;for(let n=V;;n+=V){let r=n<=a?Yn:n>=a+Xn?Xn:n-a;if(e<r)break;let i=e-r,o=V-r;t.push(sr(pr(r+i%o,0))),e=H(i/o)}t.push(sr(pr(e,0))),a=mr(i,c,s===o),i=0,++s}++i,++r}return t.join(``)},_r={version:`2.3.1`,ucs2:{decode:ur,encode:dr},decode:hr,encode:gr,toASCII:function(e){return lr(e,function(e){return rr.test(e)?`xn--`+gr(e):e})},toUnicode:function(e){return lr(e,function(e){return nr.test(e)?hr(e.slice(4).toLowerCase()):e})}},vr={default:{options:{html:!1,xhtmlOut:!1,breaks:!1,langPrefix:`language-`,linkify:!1,typographer:!1,quotes:`“”‘’`,highlight:null,maxNesting:100},components:{core:{},block:{},inline:{}}},zero:{options:{html:!1,xhtmlOut:!1,breaks:!1,langPrefix:`language-`,linkify:!1,typographer:!1,quotes:`“”‘’`,highlight:null,maxNesting:20},components:{core:{rules:[`normalize`,`block`,`inline`,`text_join`]},block:{rules:[`paragraph`]},inline:{rules:[`text`],rules2:[`balance_pairs`,`fragments_join`]}}},commonmark:{options:{html:!0,xhtmlOut:!0,breaks:!1,langPrefix:`language-`,linkify:!1,typographer:!1,quotes:`“”‘’`,highlight:null,maxNesting:20},components:{core:{rules:[`normalize`,`block`,`inline`,`text_join`]},block:{rules:[`blockquote`,`code`,`fence`,`heading`,`hr`,`html_block`,`lheading`,`list`,`reference`,`paragraph`]},inline:{rules:[`autolink`,`backticks`,`emphasis`,`entity`,`escape`,`html_inline`,`image`,`link`,`newline`,`text`],rules2:[`balance_pairs`,`emphasis`,`fragments_join`]}}}},yr=/^(vbscript|javascript|file|data):/,br=/^data:image\/(gif|png|jpeg|webp);/;function xr(e){let t=e.trim().toLowerCase();return yr.test(t)?br.test(t):!0}var Sr=[`http:`,`https:`,`mailto:`];function Cr(e){let t=ie(e,!0);if(t.hostname&&(!t.protocol||Sr.indexOf(t.protocol)>=0))try{t.hostname=_r.toASCII(t.hostname)}catch{}return d(f(t))}function wr(e){let t=ie(e,!0);if(t.hostname&&(!t.protocol||Sr.indexOf(t.protocol)>=0))try{t.hostname=_r.toUnicode(t.hostname)}catch{}return c(f(t),c.defaultChars+`%`)}function W(e,t){if(!(this instanceof W))return new W(e,t);t||je(e)||(t=e||{},e=`default`),this.inline=new R,this.block=new Zt,this.core=new kt,this.renderer=new M,this.linkify=new z,this.validateLink=xr,this.normalizeLink=Cr,this.normalizeLinkText=wr,this.utils=ke,this.helpers=Pe({},nt),this.options={},this.configure(e),t&&this.set(t)}W.prototype.set=function(e){return Pe(this.options,e),this},W.prototype.configure=function(e){let t=this;if(je(e)){let t=e;if(e=vr[t],!e)throw Error('Wrong `markdown-it` preset "'+t+`", check name`)}if(!e)throw Error("Wrong `markdown-it` preset, can't be empty");return e.options&&t.set(e.options),e.components&&Object.keys(e.components).forEach(function(n){e.components[n].rules&&t[n].ruler.enableOnly(e.components[n].rules),e.components[n].rules2&&t[n].ruler2.enableOnly(e.components[n].rules2)}),this},W.prototype.enable=function(e,t){let n=[];Array.isArray(e)||(e=[e]),[`core`,`block`,`inline`].forEach(function(t){n=n.concat(this[t].ruler.enable(e,!0))},this),n=n.concat(this.inline.ruler2.enable(e,!0));let r=e.filter(function(e){return n.indexOf(e)<0});if(r.length&&!t)throw Error(`MarkdownIt. Failed to enable unknown rule(s): `+r);return this},W.prototype.disable=function(e,t){let n=[];Array.isArray(e)||(e=[e]),[`core`,`block`,`inline`].forEach(function(t){n=n.concat(this[t].ruler.disable(e,!0))},this),n=n.concat(this.inline.ruler2.disable(e,!0));let r=e.filter(function(e){return n.indexOf(e)<0});if(r.length&&!t)throw Error(`MarkdownIt. Failed to disable unknown rule(s): `+r);return this},W.prototype.use=function(e){let t=[this].concat(Array.prototype.slice.call(arguments,1));return e.apply(e,t),this},W.prototype.parse=function(e,t){if(typeof e!=`string`)throw Error(`Input data should be a String`);let n=new this.core.State(e,this,t);return this.core.process(n),n.tokens},W.prototype.render=function(e,t){return t||={},this.renderer.render(this.parse(e,t),this.options,t)},W.prototype.parseInline=function(e,t){let n=new this.core.State(e,this,t);return n.inlineMode=!0,this.core.process(n),n.tokens},W.prototype.renderInline=function(e,t){return t||={},this.renderer.render(this.parseInline(e,t),this.options,t)};var Tr=!1,G={false:`push`,true:`unshift`,after:`push`,before:`unshift`},Er={isPermalinkSymbol:!0};function Dr(e,t,n,r){var i;if(!Tr){var a=`Using deprecated markdown-it-anchor permalink option, see https://github.com/valeriangalliat/markdown-it-anchor#permalinks`;typeof process==`object`&&process&&process.emitWarning?process.emitWarning(a):console.warn(a),Tr=!0}var o=[Object.assign(new n.Token(`link_open`,`a`,1),{attrs:[].concat(t.permalinkClass?[[`class`,t.permalinkClass]]:[],[[`href`,t.permalinkHref(e,n)]],Object.entries(t.permalinkAttrs(e,n)))}),Object.assign(new n.Token(`html_block`,``,0),{content:t.permalinkSymbol,meta:Er}),new n.Token(`link_close`,`a`,-1)];t.permalinkSpace&&n.tokens[r+1].children[G[t.permalinkBefore]](Object.assign(new n.Token(`text`,``,0),{content:` `})),(i=n.tokens[r+1].children)[G[t.permalinkBefore]].apply(i,o)}function Or(e){return`#`+e}function kr(e){return{}}var Ar={class:`header-anchor`,symbol:`#`,renderHref:Or,renderAttrs:kr};function K(e){function t(n){return n=Object.assign({},t.defaults,n),function(t,r,i,a){return e(t,n,r,i,a)}}return t.defaults=Object.assign({},Ar),t.renderPermalinkImpl=e,t}function jr(e){var t=[],n=e.filter(function(e){if(e[0]!==`class`)return!0;t.push(e[1])});return t.length>0&&n.unshift([`class`,t.join(` `)]),n}var Mr=K(function(e,t,n,r,i){var a,o=[Object.assign(new r.Token(`link_open`,`a`,1),{attrs:jr([].concat(t.class?[[`class`,t.class]]:[],[[`href`,t.renderHref(e,r)]],t.ariaHidden?[[`aria-hidden`,`true`]]:[],Object.entries(t.renderAttrs(e,r))))}),Object.assign(new r.Token(`html_inline`,``,0),{content:t.symbol,meta:Er}),new r.Token(`link_close`,`a`,-1)];if(t.space){var s=typeof t.space==`string`?t.space:` `;r.tokens[i+1].children[G[t.placement]](Object.assign(new r.Token(typeof t.space==`string`?`html_inline`:`text`,``,0),{content:s}))}(a=r.tokens[i+1].children)[G[t.placement]].apply(a,o)});Object.assign(Mr.defaults,{space:!0,placement:`after`,ariaHidden:!1});var q=K(Mr.renderPermalinkImpl);q.defaults=Object.assign({},Mr.defaults,{ariaHidden:!0});var Nr=K(function(e,t,n,r,i){var a=[Object.assign(new r.Token(`link_open`,`a`,1),{attrs:jr([].concat(t.class?[[`class`,t.class]]:[],[[`href`,t.renderHref(e,r)]],Object.entries(t.renderAttrs(e,r))))})].concat(t.safariReaderFix?[new r.Token(`span_open`,`span`,1)]:[],r.tokens[i+1].children,t.safariReaderFix?[new r.Token(`span_close`,`span`,-1)]:[],[new r.Token(`link_close`,`a`,-1)]);r.tokens[i+1]=Object.assign(new r.Token(`inline`,``,0),{children:a})});Object.assign(Nr.defaults,{safariReaderFix:!1});var Pr=K(function(e,t,n,r,i){var a;if(![`visually-hidden`,`aria-label`,`aria-describedby`,`aria-labelledby`].includes(t.style))throw Error("`permalink.linkAfterHeader` called with unknown style option `"+t.style+"`");if(![`aria-describedby`,`aria-labelledby`].includes(t.style)&&!t.assistiveText)throw Error("`permalink.linkAfterHeader` called without the `assistiveText` option in `"+t.style+"` style");if(t.style===`visually-hidden`&&!t.visuallyHiddenClass)throw Error("`permalink.linkAfterHeader` called without the `visuallyHiddenClass` option in `visually-hidden` style");var o=r.tokens[i+1].children.filter(function(e){return e.type===`text`||e.type===`code_inline`}).reduce(function(e,t){return e+t.content},``),s=[],c=[];if(t.class&&c.push([`class`,t.class]),c.push([`href`,t.renderHref(e,r)]),c.push.apply(c,Object.entries(t.renderAttrs(e,r))),t.style===`visually-hidden`){if(s.push(Object.assign(new r.Token(`span_open`,`span`,1),{attrs:[[`class`,t.visuallyHiddenClass]]}),Object.assign(new r.Token(`text`,``,0),{content:t.assistiveText(o)}),new r.Token(`span_close`,`span`,-1)),t.space){var l=typeof t.space==`string`?t.space:` `;s[G[t.placement]](Object.assign(new r.Token(typeof t.space==`string`?`html_inline`:`text`,``,0),{content:l}))}s[G[t.placement]](Object.assign(new r.Token(`span_open`,`span`,1),{attrs:[[`aria-hidden`,`true`]]}),Object.assign(new r.Token(`html_inline`,``,0),{content:t.symbol,meta:Er}),new r.Token(`span_close`,`span`,-1))}else s.push(Object.assign(new r.Token(`html_inline`,``,0),{content:t.symbol,meta:Er}));t.style===`aria-label`?c.push([`aria-label`,t.assistiveText(o)]):[`aria-describedby`,`aria-labelledby`].includes(t.style)&&c.push([t.style,e]);var u=[Object.assign(new r.Token(`link_open`,`a`,1),{attrs:jr(c)})].concat(s,[new r.Token(`link_close`,`a`,-1)]);(a=r.tokens).splice.apply(a,[i+3,0].concat(u)),t.wrapper&&(r.tokens.splice(i,0,Object.assign(new r.Token(`html_block`,``,0),{content:t.wrapper[0]+`
`})),r.tokens.splice(i+3+u.length+1,0,Object.assign(new r.Token(`html_block`,``,0),{content:t.wrapper[1]+`
`})))});function Fr(e,t,n,r){var i=e,a=r;if(n&&Object.prototype.hasOwnProperty.call(t,i))throw Error("User defined `id` attribute `"+e+"` is not unique. Please fix it in your Markdown to continue.");for(;Object.prototype.hasOwnProperty.call(t,i);)i=e+`-`+a,a+=1;return t[i]=!0,i}function J(e,t){t=Object.assign({},J.defaults,t),e.core.ruler.push(`anchor`,function(e){for(var n,r={},i=e.tokens,a=Array.isArray(t.level)?(n=t.level,function(e){return n.includes(e)}):function(e){return function(t){return t>=e}}(t.level),o=0;o<i.length;o++){var s=i[o];if(s.type===`heading_open`&&a(Number(s.tag.substr(1)))){var c=t.getTokensText(i[o+1].children),l=s.attrGet(`id`);l=l==null?Fr(l=t.slugifyWithState?t.slugifyWithState(c,e):t.slugify(c),r,!1,t.uniqueSlugStartIndex):Fr(l,r,!0,t.uniqueSlugStartIndex),s.attrSet(`id`,l),!1!==t.tabIndex&&s.attrSet(`tabindex`,``+t.tabIndex),typeof t.permalink==`function`?t.permalink(l,t,e,o):(t.permalink||t.renderPermalink&&t.renderPermalink!==Dr)&&t.renderPermalink(l,t,e,o),o=i.indexOf(s),t.callback&&t.callback(s,{slug:l,title:c})}}})}Object.assign(Pr.defaults,{style:`visually-hidden`,space:!0,placement:`after`,wrapper:null}),J.permalink={__proto__:null,legacy:Dr,renderHref:Or,renderAttrs:kr,makePermalink:K,linkInsideHeader:Mr,ariaHidden:q,headerLink:Nr,linkAfterHeader:Pr},J.defaults={level:1,slugify:function(e){return encodeURIComponent(String(e).trim().toLowerCase().replace(/\s+/g,`-`))},uniqueSlugStartIndex:1,tabIndex:`-1`,getTokensText:function(e){return e.filter(function(e){return[`text`,`code_inline`].includes(e.type)}).map(function(e){return e.content}).join(``)},permalink:!1,renderPermalink:Dr,permalinkClass:q.defaults.class,permalinkSpace:q.defaults.space,permalinkSymbol:`¶`,permalinkBefore:q.defaults.placement===`before`,permalinkHref:q.defaults.renderHref,permalinkAttrs:q.defaults.renderAttrs},J.default=J;var Ir=new W({html:!1,linkify:!0,typographer:!0,breaks:!1}).use(J,{permalink:J.permalink.headerLink()}),Y=[{dir:`10-技术知识`,name:`技术知识`,icon:`⌘`,desc:`技术概念、原理、框架和工具说明`},{dir:`20-排障手册`,name:`排障手册`,icon:`⚡`,desc:`故障现象、排查步骤、根因、修复和回滚`},{dir:`30-项目经验`,name:`项目经验`,icon:`◆`,desc:`项目背景、设计决策、交付经验和复盘`},{dir:`40-操作手册`,name:`操作手册`,icon:`▣`,desc:`标准作业流程、Runbook 和日常运维步骤`},{dir:`50-代码实践`,name:`代码实践`,icon:`</>`,desc:`编码规范、重构、测试和工程实践`},{dir:`60-架构设计`,name:`架构设计`,icon:`◎`,desc:`架构方案、技术选型、系统设计和权衡`},{dir:`70-学习笔记`,name:`学习笔记`,icon:`◐`,desc:`课程、书籍、文章和论文学习记录`},{dir:`80-资源索引`,name:`资源索引`,icon:`↗`,desc:`链接、工具和资料清单`}],X=Object.entries(Object.assign({"../20-排障手册/2026-05-29-ACP-Deployment-部署风险与排查清单.md":n,"../40-操作手册/2026-05-29-ACP-Deployment-部署顺序与模块总览.md":r,"../40-操作手册/2026-05-29-Vector-日志输出到-Kafka-最佳实践.md":i,"../60-架构设计/2026-05-29-ACP-平台部署组件依赖关系.md":a})).map(([e,t])=>Lr(e,t)).sort((e,t)=>String(t.updated||t.created||``).localeCompare(String(e.updated||e.created||``))),Z={query:``,selectedCategory:`all`,selectedTag:`all`,routeDoc:new URLSearchParams(location.search).get(`doc`)||``};function Lr(e,t){let n=Rr(t),r=t.replace(/^---[\s\S]*?---\s*/,``),i=e.replace(/^\.\.\//,``).split(`/`)[0],a=encodeURIComponent(e.replace(/^\.\.\//,``).replace(/\.md$/,``)),o=n.title||e.split(`/`).pop().replace(/\.md$/,``),s=Br(r);return{path:e,dir:i,slug:a,title:o,body:r,html:Ir.render(r),excerpt:s.slice(0,180),readingTime:Math.max(1,Math.ceil(s.length/500)),...n,tags:Array.isArray(n.tags)?n.tags:[]}}function Rr(e){let t=e.match(/^---\n([\s\S]*?)\n---/);if(!t)return{};let n={},r=t[1].split(`
`),i=null;for(let e of r){let t=e.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);if(t){i=t[1];let e=t[2].trim();n[i]=e===``?[]:zr(e);continue}let r=e.match(/^\s*-\s*(.*)$/);r&&i&&(Array.isArray(n[i])||(n[i]=[]),n[i].push(zr(r[1].trim())))}return n}function zr(e){return e.replace(/^['"]|['"]$/g,``)}function Br(e){return e.replace(/```[\s\S]*?```/g,` `).replace(/`[^`]*`/g,` `).replace(/!\[[^\]]*\]\([^)]*\)/g,` `).replace(/\[[^\]]*\]\([^)]*\)/g,` `).replace(/[#>*_~\-|]/g,` `).replace(/\s+/g,` `).trim()}function Q(e){return String(e??``).replaceAll(`&`,`&amp;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`).replaceAll(`"`,`&quot;`).replaceAll(`'`,`&#039;`)}function Vr(e){return Y.find(t=>t.dir===e)||{name:e,icon:`•`,desc:``}}function Hr(){return[...new Set(X.flatMap(e=>e.tags))].sort()}function Ur(){let e=Z.query.trim().toLowerCase();return X.filter(t=>{let n=Z.selectedCategory===`all`||t.dir===Z.selectedCategory,r=Z.selectedTag===`all`||t.tags.includes(Z.selectedTag),i=`${t.title} ${t.excerpt} ${t.tags.join(` `)} ${t.category||``}`.toLowerCase(),a=!e||i.includes(e);return n&&r&&a})}function Wr(){return X.find(e=>e.slug===Z.routeDoc)}function Gr(e){Z.routeDoc=e?e.slug:``;let t=new URL(location.href);e?t.searchParams.set(`doc`,e.slug):t.searchParams.delete(`doc`),history.pushState({},``,t),$(),window.scrollTo({top:0,behavior:`smooth`})}function Kr(e){document.querySelector(`#app`).innerHTML=`
    <div class="site-shell">
      <header class="topbar">
        <a class="brand" href="./" data-action="home">
          <span class="brand-mark">K</span>
          <span><strong>KnowledgeBase</strong><small>DrSniper Docs</small></span>
        </a>
        <nav>
          <a href="#docs" data-action="home">Docs</a>
          <a href="https://github.com/DrSniper/KnowledgeBase" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>
      ${e}
      <footer><span>Built for GitHub Pages</span><span>Docs are generated from Markdown files.</span></footer>
    </div>`}function qr(){let e=Hr(),t=Ur();Kr(`
    <main>
      <section class="hero">
        <div class="hero-badge">个人技术知识库 · GitHub Pages</div>
        <h1>把问题、排障和经验沉淀成可检索的工程文档。</h1>
        <p>收集 Kubernetes、DevOps、日志链路、代码实践和项目经验，用统一模板、分类和标签组织，方便长期复用。</p>
        <div class="hero-actions">
          <a class="button primary" href="#docs">浏览文档</a>
          <a class="button secondary" href="https://github.com/DrSniper/KnowledgeBase" target="_blank" rel="noreferrer">查看仓库</a>
        </div>
        <div class="metrics">
          <div><strong>${X.length}</strong><span>Docs</span></div>
          <div><strong>${Y.length}</strong><span>Categories</span></div>
          <div><strong>${e.length}</strong><span>Tags</span></div>
        </div>
      </section>
      <section class="category-grid">
        ${Y.map(e=>`
          <button class="category-card ${Z.selectedCategory===e.dir?`active`:``}" data-category="${Q(e.dir)}">
            <span>${e.icon}</span><strong>${e.name}</strong><small>${e.desc}</small>
          </button>`).join(``)}
      </section>
      <section id="docs" class="docs-section">
        <div class="section-heading">
          <div><span class="eyebrow">Documentation</span><h2>文档列表</h2></div>
          ${Z.selectedCategory!==`all`||Z.selectedTag!==`all`||Z.query?`<button class="reset" data-action="reset">清除筛选</button>`:``}
        </div>
        <div class="filters">
          <input id="search" type="search" placeholder="搜索标题、摘要、标签..." value="${Q(Z.query)}" />
          <select id="categorySelect">
            <option value="all">全部分类</option>
            ${Y.map(e=>`<option value="${Q(e.dir)}" ${Z.selectedCategory===e.dir?`selected`:``}>${e.name}</option>`).join(``)}
          </select>
          <select id="tagSelect">
            <option value="all">全部标签</option>
            ${e.map(e=>`<option value="${Q(e)}" ${Z.selectedTag===e?`selected`:``}>${Q(e)}</option>`).join(``)}
          </select>
        </div>
        ${t.length?`<div class="doc-grid">
          ${t.map(e=>`
            <article class="doc-card" data-doc="${e.slug}">
              <div class="doc-meta"><span>${Vr(e.dir).name}</span><span>${e.readingTime} min read</span></div>
              <h3>${Q(e.title)}</h3>
              <p>${Q(e.excerpt)}</p>
              <div class="tag-row">${e.tags.slice(0,4).map(e=>`<span>${Q(e)}</span>`).join(``)}</div>
            </article>`).join(``)}
        </div>`:`<div class="empty">暂无匹配文档。</div>`}
      </section>
    </main>`),document.querySelectorAll(`[data-category]`).forEach(e=>e.addEventListener(`click`,()=>{Z.selectedCategory=e.dataset.category,Z.routeDoc=``,$()})),document.querySelectorAll(`[data-doc]`).forEach(e=>e.addEventListener(`click`,()=>{Gr(X.find(t=>t.slug===e.dataset.doc))})),document.querySelector(`#search`)?.addEventListener(`input`,e=>{Z.query=e.target.value,$(),document.querySelector(`#search`)?.focus()}),document.querySelector(`#categorySelect`)?.addEventListener(`change`,e=>{Z.selectedCategory=e.target.value,$()}),document.querySelector(`#tagSelect`)?.addEventListener(`change`,e=>{Z.selectedTag=e.target.value,$()}),document.querySelector(`[data-action="reset"]`)?.addEventListener(`click`,()=>{Z.selectedCategory=`all`,Z.selectedTag=`all`,Z.query=``,$()})}function Jr(e){Kr(`
    <main class="reader-layout">
      <aside class="reader-sidebar">
        <button class="back" data-action="back">← 返回文档列表</button>
        <div class="toc-card">
          <span class="eyebrow">Current</span>
          <h3>${Q(e.title)}</h3>
          <p>${Vr(e.dir).name} · ${e.readingTime} min read</p>
          <div class="tag-row">${e.tags.map(e=>`<span data-tag="${Q(e)}">${Q(e)}</span>`).join(``)}</div>
        </div>
      </aside>
      <article class="markdown-body">
        <div class="article-kicker">${Vr(e.dir).name}</div>
        <h1>${Q(e.title)}</h1>
        <div class="article-meta">
          <span>Created: ${Q(e.created||`unknown`)}</span>
          <span>Updated: ${Q(e.updated||`unknown`)}</span>
          <span>Status: ${Q(e.status||`active`)}</span>
        </div>
        <div>${e.html}</div>
      </article>
    </main>`),document.querySelector(`[data-action="back"]`)?.addEventListener(`click`,()=>Gr(null)),document.querySelectorAll(`[data-tag]`).forEach(e=>e.addEventListener(`click`,()=>{Z.selectedTag=e.dataset.tag,Gr(null)}))}function $(){let e=Wr();e?Jr(e):qr(),document.querySelectorAll(`[data-action="home"]`).forEach(e=>e.addEventListener(`click`,e=>{e.preventDefault(),Gr(null)}))}window.addEventListener(`popstate`,()=>{Z.routeDoc=new URLSearchParams(location.search).get(`doc`)||``,$()}),$();