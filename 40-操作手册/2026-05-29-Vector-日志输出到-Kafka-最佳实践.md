---
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

```text
application logs -> Vector source -> Vector transform -> Kafka sink -> consumer / Flink / Logstash / ClickHouse / Elasticsearch
```

## 3. 推荐架构

### 3.1 单集群通用链路

```text
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
```

### 3.2 Agent + Aggregator 模式

生产环境更推荐：

```text
Vector Agent DaemonSet
        |
        | vector sink / kafka sink
        v
Vector Aggregator Deployment
        |
        v
Kafka
```

适用场景：

- 节点较多
- 日志量大
- 希望在 Aggregator 层统一清洗、脱敏、路由、限流
- 避免每个节点都直接连接 Kafka，降低 Kafka broker 连接数压力

如果规模较小，也可以 Agent 直接输出到 Kafka。

## 4. 最小可用配置

以下示例将文件日志采集后输出到 Kafka。

```toml
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
```

## 5. 生产推荐配置

```toml
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
```

说明：

- `topic = "logs.{{ env }}.{{ namespace }}"` 表示动态 topic，具体字段必须在事件中存在。
- 如果 Kafka 不允许自动创建 topic，需要提前创建好所有可能的 topic。
- 如果不希望动态 topic，建议固定为 `logs.<env>.application`，再由下游按字段分流。

## 6. Kafka Topic 规划最佳实践

### 6.1 Topic 命名

推荐：

```text
logs.<env>.<domain>
logs.<env>.<namespace>
logs.<env>.<service>
```

示例：

```text
logs.prod.payment
logs.prod.default
logs.uat.file-service
```

不建议：

```text
logs
all-logs
app
```

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

```text
logs.<env>.<namespace>
```

关键业务可单独拆：

```text
logs.prod.payment
logs.prod.file-service
```

## 7. 可靠性最佳实践

### 7.1 使用磁盘 Buffer

Kafka 短暂不可用、网络抖动、broker 滚动重启时，内存 buffer 很容易丢数据或撑爆内存。

推荐：

```toml
buffer.type = "disk"
buffer.max_size = 10737418240
buffer.when_full = "block"
```

含义：

- `disk`：写入本地磁盘缓冲
- `max_size`：按节点或实例容量评估
- `block`：buffer 满时阻塞上游，优先保护数据不丢

如果业务更关注应用不受日志链路影响，可以考虑：

```toml
buffer.when_full = "drop_newest"
```

但要明确接受日志丢失风险。

### 7.2 Kafka ack 推荐

生产环境建议可靠性优先：

```toml
acknowledgements.enabled = true
acknowledgements.timeout_secs = 30
```

Kafka topic 侧建议：

```properties
acks=all
min.insync.replicas=2
replication.factor=3
```

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

```toml
compression = "lz4"
```

选择建议：

| 压缩 | 特点 | 建议 |
|---|---|---|
| lz4 | 速度快，压缩率适中 | 日志场景推荐 |
| gzip | 压缩率高，CPU 成本高 | 带宽极紧张时使用 |
| snappy | 通用平衡 | 可用 |
| none | 无 CPU 成本，但网络/磁盘压力大 | 不推荐生产大流量 |

### 8.2 批量参数

吞吐优先：

```toml
batch.max_events = 5000
batch.timeout_secs = 2
```

低延迟优先：

```toml
batch.max_events = 500
batch.timeout_secs = 0.5
```

通用推荐：

```toml
batch.max_events = 1000
batch.timeout_secs = 1
```

### 8.3 key_field 设计

推荐：

```toml
key_field = "service"
```

或：

```toml
key_field = "pod"
```

选择原则：

- 同一个 key 会进入同一个 partition，可保持局部有序。
- key 过于集中会导致 partition 热点。
- 不建议固定 key。
- 高吞吐场景可以考虑不设置 key 或使用更分散字段。

## 9. 安全配置示例

### 9.1 SASL/SCRAM 示例

```toml
[sinks.kafka_logs]
type = "kafka"
inputs = ["normalize_logs"]
bootstrap_servers = "kafka-0.kafka:9093,kafka-1.kafka:9093,kafka-2.kafka:9093"
topic = "logs.prod.application"
encoding.codec = "json"

sasl.enabled = true
sasl.mechanism = "SCRAM-SHA-512"
sasl.username = "${KAFKA_USERNAME}"
# 从环境变量或 Secret 注入，不要在配置文件中写真实密码
sasl.password = "${KAFKA_PASSWORD}"

tls.enabled = true
```

注意：

- 不要把 Kafka 密码写死在配置文件中。
- Kubernetes 中建议使用 Secret 注入环境变量或挂载文件。
- 生产环境建议启用 TLS。

### 9.2 Kubernetes Secret 示例

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: vector-kafka-auth
  namespace: observability
type: Opaque
stringData:
  KAFKA_USERNAME: vector-writer
  KAFKA_PASSWORD: "REDACTED"
```

Deployment/DaemonSet 中引用：

```yaml
envFrom:
  - secretRef:
      name: vector-kafka-auth
```

## 10. Kubernetes ConfigMap 示例

```yaml
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
```

## 11. 验证方式

### 11.1 检查 Vector 配置

```bash
vector validate /etc/vector/vector.toml
```

Kubernetes 中：

```bash
kubectl exec -n observability ds/vector -- vector validate /etc/vector/vector.toml
```

### 11.2 查看 Vector Pod 状态

```bash
kubectl get pod -n observability -l app=vector -o wide
kubectl logs -n observability -l app=vector --tail=200
```

### 11.3 检查 Kafka topic

```bash
kafka-topics.sh \
  --bootstrap-server kafka-0.kafka:9092 \
  --list | grep '^logs\.'
```

### 11.4 消费验证

```bash
kafka-console-consumer.sh \
  --bootstrap-server kafka-0.kafka:9092 \
  --topic logs.test.default \
  --from-beginning \
  --max-messages 10
```

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
| buffer 满 | 可能阻塞或丢日志 | 根据业务选择 `block` 或 `drop_newest` |
| topic 过多 | Kafka controller 压力增大 | 限制动态 topic，预创建 topic |
| key 分布不均 | partition 热点 | 选择更分散的 key 或取消 key |
| 日志包含敏感信息 | 可能造成合规风险 | Vector transform 中脱敏 |
| 直接写死密码 | 凭证泄露 | 使用 Secret 或环境变量 |
| batch 太大 | 延迟升高 | 根据吞吐/延迟目标调优 |
| batch 太小 | 吞吐下降，broker 压力增大 | 生产压测后确定参数 |

## 13. 回滚方案

### 13.1 回滚 Vector 配置

如果通过 ConfigMap 管理：

```bash
kubectl rollout history ds/vector -n observability
kubectl rollout undo ds/vector -n observability
```

如果使用 Helm：

```bash
helm history vector -n observability
helm rollback vector <REVISION> -n observability
```

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

```toml
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
```

## 15. 相关链接

- Vector Kafka sink 官方文档：https://vector.dev/docs/reference/configuration/sinks/kafka/
- [[知识库规范]]
- [[标签体系]]
