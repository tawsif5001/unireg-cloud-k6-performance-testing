import http from 'k6/http';

const BASE_URL = 'https://uni-reg-cloud.vercel.app';

export default function () {
  // 1. Login credentials in JSON format
  const payload = JSON.stringify({
    studentId: 'A2026001',
    password: 'Pw4821',
  });

  // 2. Header: tell the server we are sending JSON
  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  // 3. Send the login POST request
  const loginRes = http.post(`${BASE_URL}/api/login`, payload, params);

  // 4. Extract the token from the response (like JSON Extractor $.token in JMeter)
  const token = loginRes.json('token');
  console.log('Token: ' + token);

  // 5. Build headers that carry the token (like Authorization in Header Manager)
  const authParams = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  // 6. Get the course list using the token
  const coursesRes = http.get(`${BASE_URL}/api/courses`, authParams);
  console.log('Courses status: ' + coursesRes.status);
  console.log('Courses body: ' + coursesRes.body);
}