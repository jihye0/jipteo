// 실시간 공유용 Firebase 웹 앱 설정. null이면 공유 기능이 꺼집니다.
// apiKey는 비밀번호가 아니라 프로젝트 식별값이라 공개 저장소에 둬도 됩니다. 실제 보호는 데이터베이스 규칙(24자리 방 코드)으로 합니다.
window.JT_FIREBASE = {
  apiKey: "AIzaSyAWzGmoCfcROQhOuxjWu_jChn89XnKEQWY",
  authDomain: "jiptoe-bc18c.firebaseapp.com",
  databaseURL: "https://jiptoe-bc18c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "jiptoe-bc18c",
  storageBucket: "jiptoe-bc18c.firebasestorage.app",
  messagingSenderId: "667222972235",
  appId: "1:667222972235:web:e74d465f199613fbab3ace"
};

// 허용 계정은 여기 적지 않습니다. Firebase 데이터베이스 규칙(비공개)에만 두고, 사이트는 읽기 허용 여부로 판단합니다.
window.JT_ALLOWED = [];
