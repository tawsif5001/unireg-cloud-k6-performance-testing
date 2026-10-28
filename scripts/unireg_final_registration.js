import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

const BASE_URL = 'https://uni-reg-cloud.vercel.app';

// Load profile and pass/fail rules (same as the JMeter test)
export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up: one new student every 3 seconds
    { duration: '270s', target: 10 }, // Steady state: 10 students for the rest of 5 minutes
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // R2: 95% of requests within 3 seconds
    http_req_failed: ['rate<0.01'],    // R3: fewer than 1 in 100 requests fail

    // R2 for each page, to find the slowest step
    'group_duration{group:::Open_Home}': ['p(95)<3000'],
    'group_duration{group:::Log_In}': ['p(95)<3000'],
    'group_duration{group:::Course_Detail}': ['p(95)<3000'],
    'group_duration{group:::My_Registration}': ['p(95)<3000'],
    'group_duration{group:::Log_Out}': ['p(95)<3000'],
  },
};

// Load all students from the CSV file once and share them with every virtual user
const students = new SharedArray('students', function () {
  const csvText = open('../data/users.csv');
  return papaparse.parse(csvText, { header: true, skipEmptyLines: true }).data;
});

// Wait 5 to 10 seconds, like a real student reading the page before the next click
function thinkTime() {
  sleep(5 + Math.random() * 5);
}

// Print a failed request with its status and body, as evidence for the report
function logFailure(pageName, studentId, res) {
  console.log(pageName + ' failed for ' + studentId + ' | status: ' + res.status + ' | body: ' + res.body);
}

export default function () {
  // Give each virtual user its own account for the whole test (session pinning)
  const student = students[(exec.vu.idInTest - 1) % students.length];

  // Open home page
  group('Open_Home', function () {
    const homeRes = http.get(`${BASE_URL}/`);
    check(homeRes, {
      'home page status is 200': (r) => r.status === 200,
    });

    const infoRes = http.get(`${BASE_URL}/api/info`);
    check(infoRes, {
      'portal info status is 200': (r) => r.status === 200,
    });
  });

  thinkTime();

  // Log in and load the course list
  // These boxes are created outside the group so we can read them after the group ends
  let loginRes;
  let coursesRes;
  let authParams;

  group('Log_In', function () {
    loginRes = http.post(
      `${BASE_URL}/api/login`,
      JSON.stringify({ studentId: student.studentId, password: student.password }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    check(loginRes, {
      'login status is 200': (r) => r.status === 200,
      'login returns a token': (r) => r.body.includes('token'),
    });

    // Leave the group early if login failed (the journey stops below)
    if (loginRes.status !== 200) {
      return;
    }

    // Headers that carry the token for every request after login
    const token = loginRes.json('token');
    authParams = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    };

    coursesRes = http.get(`${BASE_URL}/api/courses`, authParams);
    check(coursesRes, {
      'course list status is 200': (r) => r.status === 200,
    });
  });

  // Stop this journey if login failed, because every next page needs the token
  if (loginRes.status !== 200) {
    logFailure('Login', student.studentId, loginRes);
    thinkTime();
    return;
  }

  // Stop this journey if the course list failed, because we have no course to open
  if (coursesRes.status !== 200) {
    logFailure('Course list', student.studentId, coursesRes);
    thinkTime();
    return;
  }

  // Pick one course at random from the student's own university
  const courses = coursesRes.json();
  const randomIndex = Math.floor(Math.random() * courses.length);
  const courseId = courses[randomIndex].id;

  thinkTime();

  // Open course detail page
  group('Course_Detail', function () {
    const detailRes = http.get(`${BASE_URL}/api/courses/${courseId}`, {
      headers: authParams.headers,
      tags: { name: '/api/courses/{id}' }, // One name for all course IDs
    });
    check(detailRes, {
      'course detail status is 200': (r) => r.status === 200,
      'course detail shows the right course': (r) => r.body.includes(courseId),
    });
    if (detailRes.status !== 200) {
      logFailure('Course detail', student.studentId, detailRes);
    }
  });

  thinkTime();

  // Open my registration page
  group('My_Registration', function () {
    const myRes = http.get(`${BASE_URL}/api/my-courses`, authParams);
    check(myRes, {
      'my registration status is 200': (r) => r.status === 200,
      'my registration returns a list': (r) => Array.isArray(r.json()),
    });
    if (myRes.status !== 200) {
      logFailure('My registration', student.studentId, myRes);
    }
  });

  thinkTime();

  // Log out
  group('Log_Out', function () {
    const logoutRes = http.post(`${BASE_URL}/api/logout`, null, authParams);
    check(logoutRes, {
      'logout status is 200': (r) => r.status === 200,
      'logout is confirmed': (r) => r.json('ok') === true,
    });
    if (logoutRes.status !== 200) {
      logFailure('Logout', student.studentId, logoutRes);
    }
  });

  thinkTime();
}