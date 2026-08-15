pipeline {
  agent any

  // All 3 jobs share this lock, so builds run one at a time (needs the Lockable Resources plugin)
  options {
    lock('docker-build')
  }

  environment {
    AWS_REGION   = 'us-east-1'
    ECR_REGISTRY = '389517403340.dkr.ecr.us-east-1.amazonaws.com' // AWS ACCOUNT_ID
    CLUSTER      = 'nexus-ai'
    IMAGE        = "${ECR_REGISTRY}/nexus-ai-backend:${GIT_COMMIT}"
    POSTGRES_IMAGE = "${ECR_REGISTRY}/nexus-ai-backend:postgres-pg15-vector-0.8.6-r1"
  }

  stages {
    // Run unit tests in a throwaway node container (fails the build if they fail)
    stage('Test') {
      steps {
        sh 'docker run --rm -v $WORKSPACE:/app -w /app node:24-alpine sh -c "npm ci && npm test -- --runInBand && npm run build"'
      }
    }

    stage('Build image') {
      steps {
        sh 'docker build -t $IMAGE .'
        sh '''
          if ! aws ecr describe-images --repository-name nexus-ai-backend --image-ids imageTag=postgres-pg15-vector-0.8.6-r1 >/dev/null 2>&1; then
            docker build -f Kubernetes/postgres.Dockerfile -t $POSTGRES_IMAGE .
          fi
        '''
      }
    }

    stage('Push to ECR') {
      steps {
        sh 'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY'
        sh 'docker push $IMAGE'
        sh '''
          if ! aws ecr describe-images --repository-name nexus-ai-backend --image-ids imageTag=postgres-pg15-vector-0.8.6-r1 >/dev/null 2>&1; then
            docker push $POSTGRES_IMAGE
          fi
        '''
      }
    }

    stage('Deploy to EKS') {
      steps {
        sh 'aws eks update-kubeconfig --region $AWS_REGION --name $CLUSTER'
        sh 'kubectl apply -f Kubernetes/evaluation-sandbox-rbac.yaml'
        sh 'kubectl apply -f Kubernetes/evaluation-sandbox-networkpolicy.yaml'
        sh 'kubectl apply -f Kubernetes/configmap.yaml'
        sh 'kubectl apply -f Kubernetes/Services/postgres-service.yaml'
        sh 'sed "s|nexus-ai-postgres:local|$POSTGRES_IMAGE|" Kubernetes/Deployments/postgres-statefulset.yaml | kubectl apply -f -'
        sh 'kubectl rollout status statefulset/postgres --timeout=5m'
        sh 'kubectl apply -f Kubernetes/Deployments/backend-deployment.yaml'
        sh 'kubectl set image deployment/backend backend=$IMAGE migrate=$IMAGE'
        sh 'kubectl rollout status deployment/backend --timeout=5m'
      }
    }
  }

  // Free disk space after every build (pass or fail)
  post {
    always {
      sh 'docker rmi $IMAGE || true'
      sh 'docker rmi $POSTGRES_IMAGE || true'
      sh 'docker system prune -f'
    }
  }
}
