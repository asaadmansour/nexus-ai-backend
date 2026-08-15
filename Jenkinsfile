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
      }
    }

    stage('Push to ECR') {
      steps {
        sh 'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY'
        sh 'docker push $IMAGE'
      }
    }

    stage('Deploy to EKS') {
      steps {
        sh 'aws eks update-kubeconfig --region $AWS_REGION --name $CLUSTER'
        sh 'kubectl apply -f Kubernetes/configmap.yaml'
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
      sh 'docker system prune -f'
    }
  }
}
