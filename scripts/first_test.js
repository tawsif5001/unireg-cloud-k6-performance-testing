import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const res = http.get('https://uni-reg-cloud.vercel.app/');

  check(res, {
    'home page status is 200': (r) => r.status === 200,
  });
}