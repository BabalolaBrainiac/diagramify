/**
 * Comprehensive service registry with icons, colors, and metadata
 * Maps service names to visual properties for professional diagram rendering
 */

export type ServiceType = 'compute' | 'database' | 'storage' | 'network' | 'messaging' | 'cache' | 'monitoring' | 'devops' | 'analytics' | 'security' | 'ui' | 'middleware' | 'auth' | 'ml' | 'other';

export interface ServiceDefinition {
  name: string;
  icon: string; // SVG icon name or URL
  color: string; // Primary color hex code
  backgroundColor: string; // Light background color
  textColor: string; // Text color
  type: ServiceType;
  aliases: string[]; // Alternative names (postgres, postgresql, pg)
  description?: string;
  simpleIconSlug?: string; // Simple Icons CDN slug override (e.g., 'apachekafka' for Kafka)
}

const serviceRegistry: Record<string, ServiceDefinition> = {
  // AWS Compute
  ec2: {
    name: 'EC2',
    icon: 'aws-ec2',
    color: '#FF9900',
    backgroundColor: '#FFF5E6',
    textColor: '#333',
    type: 'compute',
    aliases: ['amazon-ec2', 'aws-ec2'],
    description: 'Amazon EC2 - Virtual Servers',
  },
  lambda: {
    name: 'Lambda',
    icon: 'aws-lambda',
    color: '#FF9900',
    backgroundColor: '#FFF5E6',
    textColor: '#333',
    type: 'compute',
    aliases: ['aws-lambda', 'function'],
    description: 'AWS Lambda - Serverless Functions',
  },
  ecs: {
    name: 'ECS',
    icon: 'aws-ecs',
    color: '#FF9900',
    backgroundColor: '#FFF5E6',
    textColor: '#333',
    type: 'compute',
    aliases: ['aws-ecs', 'elastic-container-service'],
  },
  eks: {
    name: 'EKS',
    icon: 'aws-eks',
    color: '#FF9900',
    backgroundColor: '#FFF5E6',
    textColor: '#333',
    type: 'compute',
    aliases: ['aws-eks', 'elastic-kubernetes'],
  },

  // AWS Storage
  s3: {
    name: 'S3',
    icon: 'aws-s3',
    color: '#569A31',
    backgroundColor: '#F0F7E8',
    textColor: '#333',
    type: 'storage',
    aliases: ['aws-s3', 's3-bucket', 'simple-storage'],
    description: 'Amazon S3 - Object Storage',
  },
  ebs: {
    name: 'EBS',
    icon: 'aws-ebs',
    color: '#569A31',
    backgroundColor: '#F0F7E8',
    textColor: '#333',
    type: 'storage',
    aliases: ['aws-ebs', 'elastic-block-storage'],
  },
  efs: {
    name: 'EFS',
    icon: 'aws-efs',
    color: '#569A31',
    backgroundColor: '#F0F7E8',
    textColor: '#333',
    type: 'storage',
    aliases: ['aws-efs', 'elastic-file-system'],
  },
  glacier: {
    name: 'Glacier',
    icon: 'aws-glacier',
    color: '#569A31',
    backgroundColor: '#F0F7E8',
    textColor: '#333',
    type: 'storage',
    aliases: ['aws-glacier', 's3-glacier'],
  },

  // AWS Database
  rds: {
    name: 'RDS',
    icon: 'aws-rds',
    color: '#527FFF',
    backgroundColor: '#EEF2FF',
    textColor: '#333',
    type: 'database',
    aliases: ['aws-rds', 'relational-database'],
  },
  dynamodb: {
    name: 'DynamoDB',
    icon: 'aws-dynamodb',
    color: '#527FFF',
    backgroundColor: '#EEF2FF',
    textColor: '#333',
    type: 'database',
    aliases: ['aws-dynamodb', 'dynamo', 'nosql'],
  },
  aurora: {
    name: 'Aurora',
    icon: 'aws-aurora',
    color: '#527FFF',
    backgroundColor: '#EEF2FF',
    textColor: '#333',
    type: 'database',
    aliases: ['aws-aurora', 'amazon-aurora'],
  },
  elasticache: {
    name: 'ElastiCache',
    icon: 'aws-elasticache',
    color: '#C925D0',
    backgroundColor: '#F8E8F8',
    textColor: '#333',
    type: 'cache',
    aliases: ['aws-elasticache', 'elasticache'],
  },
  redshift: {
    name: 'Redshift',
    icon: 'aws-redshift',
    color: '#527FFF',
    backgroundColor: '#EEF2FF',
    textColor: '#333',
    type: 'analytics',
    aliases: ['aws-redshift', 'redshift'],
  },

  // AWS Networking
  alb: {
    name: 'ALB',
    icon: 'aws-alb',
    color: '#EC7211',
    backgroundColor: '#FEF0E6',
    textColor: '#333',
    type: 'network',
    aliases: ['aws-alb', 'application-load-balancer'],
  },
  nlb: {
    name: 'NLB',
    icon: 'aws-nlb',
    color: '#EC7211',
    backgroundColor: '#FEF0E6',
    textColor: '#333',
    type: 'network',
    aliases: ['aws-nlb', 'network-load-balancer'],
  },
  cloudfront: {
    name: 'CloudFront',
    icon: 'aws-cloudfront',
    color: '#EC7211',
    backgroundColor: '#FEF0E6',
    textColor: '#333',
    type: 'network',
    aliases: ['aws-cloudfront', 'cdn'],
  },
  route53: {
    name: 'Route 53',
    icon: 'aws-route53',
    color: '#EC7211',
    backgroundColor: '#FEF0E6',
    textColor: '#333',
    type: 'network',
    aliases: ['aws-route53', 'route-53', 'dns'],
  },
  vpc: {
    name: 'VPC',
    icon: 'aws-vpc',
    color: '#EC7211',
    backgroundColor: '#FEF0E6',
    textColor: '#333',
    type: 'network',
    aliases: ['aws-vpc', 'virtual-private-cloud'],
  },

  // AWS Messaging
  sqs: {
    name: 'SQS',
    icon: 'aws-sqs',
    color: '#FF9900',
    backgroundColor: '#FFF5E6',
    textColor: '#333',
    type: 'messaging',
    aliases: ['aws-sqs', 'simple-queue'],
  },
  sns: {
    name: 'SNS',
    icon: 'aws-sns',
    color: '#FF9900',
    backgroundColor: '#FFF5E6',
    textColor: '#333',
    type: 'messaging',
    aliases: ['aws-sns', 'simple-notification'],
  },
  kinesis: {
    name: 'Kinesis',
    icon: 'aws-kinesis',
    color: '#FF9900',
    backgroundColor: '#FFF5E6',
    textColor: '#333',
    type: 'messaging',
    aliases: ['aws-kinesis', 'data-streams'],
  },

  // AWS Monitoring & Management
  cloudwatch: {
    name: 'CloudWatch',
    icon: 'aws-cloudwatch',
    color: '#759C3E',
    backgroundColor: '#F3F8EA',
    textColor: '#333',
    type: 'monitoring',
    aliases: ['aws-cloudwatch', 'cloudwatch'],
  },
  xray: {
    name: 'X-Ray',
    icon: 'aws-xray',
    color: '#759C3E',
    backgroundColor: '#F3F8EA',
    textColor: '#333',
    type: 'monitoring',
    aliases: ['aws-xray', 'xray'],
  },
  eventbridge: {
    name: 'EventBridge',
    icon: 'aws-eventbridge',
    color: '#FF9900',
    backgroundColor: '#FFF5E6',
    textColor: '#333',
    type: 'messaging',
    aliases: ['aws-eventbridge', 'eventbridge'],
  },

  // Open Source Databases
  postgresql: {
    name: 'PostgreSQL',
    icon: 'postgres',
    color: '#336791',
    backgroundColor: '#E8ECEF',
    textColor: '#333',
    type: 'database',
    aliases: ['postgres', 'pg', 'postgresql'],
    description: 'PostgreSQL - Relational Database',
  },
  mysql: {
    name: 'MySQL',
    icon: 'mysql',
    color: '#00758F',
    backgroundColor: '#E8F1F5',
    textColor: '#333',
    type: 'database',
    aliases: ['mysql', 'mariadb'],
  },
  mongodb: {
    name: 'MongoDB',
    icon: 'mongodb',
    color: '#13AA52',
    backgroundColor: '#E8F5EA',
    textColor: '#333',
    type: 'database',
    aliases: ['mongo', 'mongodb', 'nosql'],
  },
  redis: {
    name: 'Redis',
    icon: 'redis',
    color: '#DC382D',
    backgroundColor: '#FDEDEC',
    textColor: '#333',
    type: 'cache',
    aliases: ['redis', 'cache'],
    description: 'Redis - In-memory Data Store',
  },
  elasticsearch: {
    name: 'Elasticsearch',
    icon: 'elasticsearch',
    color: '#005EB8',
    backgroundColor: '#E8F0FA',
    textColor: '#333',
    type: 'analytics',
    aliases: ['elasticsearch', 'elastic'],
  },
  kafka: {
    name: 'Kafka',
    icon: 'kafka',
    color: '#000000',
    backgroundColor: '#F5F5F5',
    textColor: '#333',
    type: 'messaging',
    aliases: ['kafka', 'apache-kafka'],
    description: 'Apache Kafka - Event Streaming',
    simpleIconSlug: 'apachekafka',
  },
  rabbitmq: {
    name: 'RabbitMQ',
    icon: 'rabbitmq',
    color: '#FF6600',
    backgroundColor: '#FFF0E6',
    textColor: '#333',
    type: 'messaging',
    aliases: ['rabbitmq', 'rabbit'],
  },
  cassandra: {
    name: 'Cassandra',
    icon: 'cassandra',
    color: '#1287EB',
    backgroundColor: '#E8F2FE',
    textColor: '#333',
    type: 'database',
    aliases: ['cassandra', 'apache-cassandra'],
    simpleIconSlug: 'apachecassandra',
  },

  // Container & Orchestration
  docker: {
    name: 'Docker',
    icon: 'docker',
    color: '#2496ED',
    backgroundColor: '#E8F4FD',
    textColor: '#333',
    type: 'devops',
    aliases: ['docker', 'container'],
  },
  kubernetes: {
    name: 'Kubernetes',
    icon: 'kubernetes',
    color: '#326CE5',
    backgroundColor: '#EEF4FA',
    textColor: '#333',
    type: 'devops',
    aliases: ['kubernetes', 'k8s', 'k8'],
  },

  // Google Cloud
  gce: {
    name: 'GCE',
    icon: 'gcp-compute',
    color: '#4285F4',
    backgroundColor: '#E8F0FE',
    textColor: '#333',
    type: 'compute',
    aliases: ['gce', 'google-compute-engine'],
  },
  gcs: {
    name: 'GCS',
    icon: 'gcp-storage',
    color: '#34A853',
    backgroundColor: '#E8F5E9',
    textColor: '#333',
    type: 'storage',
    aliases: ['gcs', 'google-cloud-storage'],
  },
  bigquery: {
    name: 'BigQuery',
    icon: 'gcp-bigquery',
    color: '#4285F4',
    backgroundColor: '#E8F0FE',
    textColor: '#333',
    type: 'analytics',
    aliases: ['bigquery', 'bq'],
  },
  cloudsql: {
    name: 'Cloud SQL',
    icon: 'gcp-sql',
    color: '#4285F4',
    backgroundColor: '#E8F0FE',
    textColor: '#333',
    type: 'database',
    aliases: ['cloudsql', 'cloud-sql'],
  },
  firestore: {
    name: 'Firestore',
    icon: 'gcp-firestore',
    color: '#FFA500',
    backgroundColor: '#FFF0E6',
    textColor: '#333',
    type: 'database',
    aliases: ['firestore', 'firebase'],
  },

  // Azure
  vm: {
    name: 'Virtual Machine',
    icon: 'azure-vm',
    color: '#0078D4',
    backgroundColor: '#E8F3FA',
    textColor: '#333',
    type: 'compute',
    aliases: ['vm', 'virtual-machine', 'azure-vm'],
  },
  'app-service': {
    name: 'App Service',
    icon: 'azure-app-service',
    color: '#0078D4',
    backgroundColor: '#E8F3FA',
    textColor: '#333',
    type: 'compute',
    aliases: ['app-service', 'appservice'],
  },
  'blob-storage': {
    name: 'Blob Storage',
    icon: 'azure-storage',
    color: '#0078D4',
    backgroundColor: '#E8F3FA',
    textColor: '#333',
    type: 'storage',
    aliases: ['blob-storage', 'azure-storage'],
  },
  'azure-sql': {
    name: 'Azure SQL',
    icon: 'azure-sql',
    color: '#0078D4',
    backgroundColor: '#E8F3FA',
    textColor: '#333',
    type: 'database',
    aliases: ['azure-sql', 'azuresql'],
  },
  'cosmos-db': {
    name: 'Cosmos DB',
    icon: 'azure-cosmos',
    color: '#0078D4',
    backgroundColor: '#E8F3FA',
    textColor: '#333',
    type: 'database',
    aliases: ['cosmos-db', 'cosmosdb'],
  },

  // Web Frameworks
  nodejs: {
    name: 'Node.js',
    icon: 'nodejs',
    color: '#68A063',
    backgroundColor: '#F0F7ED',
    textColor: '#333',
    type: 'middleware',
    aliases: ['nodejs', 'node', 'express'],
  },
  python: {
    name: 'Python',
    icon: 'python',
    color: '#3776AB',
    backgroundColor: '#EDF2F7',
    textColor: '#333',
    type: 'middleware',
    aliases: ['python', 'django', 'flask', 'fastapi'],
  },
  java: {
    name: 'Java',
    icon: 'java',
    color: '#007396',
    backgroundColor: '#E8F1F7',
    textColor: '#333',
    type: 'middleware',
    aliases: ['java', 'spring', 'springboot'],
  },
  golang: {
    name: 'Go',
    icon: 'go',
    color: '#00ADD8',
    backgroundColor: '#E8F5F8',
    textColor: '#333',
    type: 'middleware',
    aliases: ['go', 'golang'],
  },
  rust: {
    name: 'Rust',
    icon: 'rust',
    color: '#CE422B',
    backgroundColor: '#FDEAE8',
    textColor: '#333',
    type: 'middleware',
    aliases: ['rust', 'actix'],
  },

  // Frontend
  react: {
    name: 'React',
    icon: 'react',
    color: '#61DAFB',
    backgroundColor: '#E8F8FB',
    textColor: '#333',
    type: 'ui',
    aliases: ['react', 'reactjs'],
  },
  vue: {
    name: 'Vue.js',
    icon: 'vue',
    color: '#4FC08D',
    backgroundColor: '#E8F5ED',
    textColor: '#333',
    type: 'ui',
    aliases: ['vue', 'vuejs'],
  },
  angular: {
    name: 'Angular',
    icon: 'angular',
    color: '#DD0031',
    backgroundColor: '#FDE8E6',
    textColor: '#333',
    type: 'ui',
    aliases: ['angular', 'angularjs'],
  },

  // Message Brokers
  mqtt: {
    name: 'MQTT',
    icon: 'mqtt',
    color: '#660066',
    backgroundColor: '#F5E8F5',
    textColor: '#333',
    type: 'messaging',
    aliases: ['mqtt', 'mosquitto'],
  },
  nats: {
    name: 'NATS',
    icon: 'nats',
    color: '#27C93F',
    backgroundColor: '#E8F7E8',
    textColor: '#333',
    type: 'messaging',
    aliases: ['nats'],
  },

  // Monitoring & Logging
  prometheus: {
    name: 'Prometheus',
    icon: 'prometheus',
    color: '#E6522C',
    backgroundColor: '#FDE8E2',
    textColor: '#333',
    type: 'monitoring',
    aliases: ['prometheus'],
  },
  grafana: {
    name: 'Grafana',
    icon: 'grafana',
    color: '#F05A28',
    backgroundColor: '#FEF0E8',
    textColor: '#333',
    type: 'monitoring',
    aliases: ['grafana'],
  },
  datadog: {
    name: 'Datadog',
    icon: 'datadog',
    color: '#632CA6',
    backgroundColor: '#F3E8F8',
    textColor: '#333',
    type: 'monitoring',
    aliases: ['datadog'],
  },

  // Security
  vault: {
    name: 'Vault',
    icon: 'vault',
    color: '#000000',
    backgroundColor: '#F5F5F5',
    textColor: '#333',
    type: 'security',
    aliases: ['vault', 'hashicorp-vault'],
  },
  oauth: {
    name: 'OAuth',
    icon: 'oauth',
    color: '#EB5424',
    backgroundColor: '#FDE8E2',
    textColor: '#333',
    type: 'auth',
    aliases: ['oauth', 'oauth2'],
  },

  // Web Servers
  nginx: {
    name: 'Nginx',
    icon: 'nginx',
    color: '#009639',
    backgroundColor: '#E8F5E8',
    textColor: '#333',
    type: 'network',
    aliases: ['nginx'],
  },
  apache: {
    name: 'Apache',
    icon: 'apache',
    color: '#D70015',
    backgroundColor: '#FDE8E8',
    textColor: '#333',
    type: 'network',
    aliases: ['apache', 'httpd'],
  },

  // Generic fallback
  service: {
    name: 'Service',
    icon: 'service',
    color: '#999999',
    backgroundColor: '#F5F5F5',
    textColor: '#333',
    type: 'other',
    aliases: ['service', 'component', 'module'],
  },
};

/**
 * Get service definition by name or alias
 */
export function getServiceDefinition(name: string): ServiceDefinition {
  const normalized = name.toLowerCase().trim();

  // Direct lookup
  if (serviceRegistry[normalized]) {
    return serviceRegistry[normalized];
  }

  // Alias lookup
  for (const [, service] of Object.entries(serviceRegistry)) {
    if (service.aliases.includes(normalized)) {
      return service;
    }
  }

  // Fallback to generic service
  return serviceRegistry.service;
}

/**
 * Get all services of a specific type
 */
export function getServicesByType(type: ServiceType): ServiceDefinition[] {
  return Object.values(serviceRegistry).filter((s) => s.type === type);
}

/**
 * Get all registered service definitions
 */
export function getAllServices(): ServiceDefinition[] {
  return Object.values(serviceRegistry);
}
