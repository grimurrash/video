var exec = require('child_process').exec;
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const FormData = require('form-data');
const net = require('net'), Socket = net.Socket;
var ps = require('ps-node');
const fs = require('fs');

size = [];
files_video = [];
command_ = "";
client = "";
status_cam = [];
options = "";
settings = "";

function connect() {
    client = new Socket(), status = null;
    oo = "";
    client.connect(3031, 'localhost', function() {
        client.on("data", function(data){
            data = JSON.parse(data.toString());
            if (data.type = "root") {
                adapter_set = new FileSync(data.dataq + '\\settings.json');
                settings = low(adapter_set);
                options = settings.get("main").value()[0];
            }
        });
    }).on("error", (err) => {
        console.log(211);
        client.destroy();
        setTimeout(function(){
            connect();
        }, 1000);
    });
};
connect();

function command(cam) {
    command_ = "ffmpeg -i \"rtsp://" + cam.login + ":" + cam.password + "@" + cam.host + ":554/cam/realmonitor?channel=1&subtype="+cam.quality+"&unicast=true&proto=Onvif\" -codec copy -f hls -hls_time " + options.timeLimit + " -strftime 1 -hls_enc 1 -hls_enc_key \""+options.key+"\" -segment_format sev -hide_banner -hls_segment_filename \""+ options.folder + "\\videos\\"+cam.id+"\\%m-%d-%Y@%H-%M-%S.sev\" \""+ options.folder + "\\videos\\"+ cam.id + "\\list.txt\" -metadata cam="+cam.id+" -y";
    return command_;
}

function checkPort(port, host, callback) {
    var socket = new Socket(), status = null;
    socket.on('connect', function () {
        status = 'open';
        socket.end();
    });
    socket.setTimeout(1500);
    socket.on('timeout', function () {
        status = 'closed';
        socket.destroy();
    });
    socket.on('error', function (exception) {
        status = 'closed';
        socket.destroy();
    });
    socket.on('close', function (exception) {
        socket.destroy();
        callback(null, status, host, port);
    });
    socket.connect(port, host);
};

function start_rec_single(cam) {
    command_ = command(cam);
    console.log(command_);
    checkPort(554, cam.host, function (error, status, host, port, mac) {
        if (status == "open") {
            if (status_cam[cam.id]) {
                status_cam[cam.id] = false;
                data = {type: "connect_cam", data: cam.title, id: cam.id};
                data = JSON.stringify(data);
                client.write(data);
            }
            command_ = command(cam);
            record = exec(command_, function (error, stdout, stderr) {
                if (stderr) {
                    console.log("std");
                    ps.lookup({command: 'ffmpeg', arguments: 'cam='+cam.id}, function(err, resultList ) {
                        var process = resultList[ 0 ];
                        if (process) {
                            console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments );
                        } else {
                            status_cam[cam.id] = true;
                            data = {type: "missed_cam", data: cam.title, id: cam.id};
                            data = JSON.stringify(data);
                            client.write(data);
                            console.error("Камера "+cam.id+" недоступна");
                            setTimeout(function(){
                                start_rec_single(cam);
                            });
                        }
                    });
                }
            });
            settings.get('cams').find({id: cam.id}).assign({pid: record.pid}).write();
            console.warn("Запись лецго! "+cam.title); 
        } else {
            if (!status_cam[cam.id]) {
                data = {type: "missed_cam", data: cam.title, id: cam.id};
                data = JSON.stringify(data);
                client.write(data);
                status_cam[cam.id] = true;
            }
            setTimeout(function(){
                start_rec_single(cam);
            }, 5000);
        }
    });
};


function start_rec() {
    cams = settings.get('cams').filter({active: true, available: true}).value();
    console.log(cams);
    if (cams.length > 0) {
        cams.forEach(cam => {
            start_rec_single(cam);
        });
    } else {
        data = {type: "no_checked_cam"};
        data = JSON.stringify(data);
        client.write(data);
        setTimeout(function(){
            start_rec();
        }, 5000);
    }
}

function getFiles(dir, files_, type = 0) {
    return new Promise(function(resolve, reject){
        files_ = files_ || [];
        var files = fs.readdirSync(dir);
        size[dir] = 0;
        files_i = 0;
        settings.get('main[0]').assign({dirSize: size}).write();
        for (var i in files) {
            var name = dir + '\\' + files[i];
            if (fs.statSync(name).isDirectory()){
                getFiles(name, files_);
            } else {
                if (name.indexOf(".sev") >= 0) {
                    fs.stat(name, function(err, stats) {
                        size[dir] = parseInt(size[dir]) + parseInt(stats.size);
                        if (size[dir] >= options.maxDirSize * 1024 * 1024 / cams.length) {
                            console.log(size[dir]);
                            clean_folder(dir);
                        }
                    });
                    files_.push(name);
                    files_i++;
                }
            }
        }
        resolve(files_);
    });
}

function clean_folder(dir) {
    getFiles(dir, [], 1).then(al => { 
        console.log(al[0]);
        fs.access(al[0], function (error) {
            if (!error) {
                fs.unlink(al[0], function(error) {
                    if (!error) {
                        console.log("Папка превысила допустимый объем. Удаляются старые файлы.");
                    }
                });
            }
        });
    });
}

function checkInternet(cb) {
    require('dns').lookup('google.com', function (err) {
        if (err && err.code == "ENOTFOUND") {
            cb(false);
        } else {
            cb(true);
        }
    })
}

function upload_videos() {
    ind = 0;
    getFiles(options.folder+"\\videos").then(files_video => {
        go = setInterval(function(){
            console.log("files.lenthd: "+files_video.length);
            if (files_video.length == ind) {
                clearInterval(go);
                setTimeout(function(){
                    upload_videos();
                }, 5000);
            } else {
                console.log("uploadvideos "+files_video[ind]);
                upload_video(files_video[ind]);
                ind++;
            }
        }, 1000);
    });
}

function time() {
    return parseInt(new Date().getTime() / 1000);
}

function upload_video(file) {
    console.log("upload video: "+file);
    camx = file.split("\\");
    camx = camx[camx.length - 2];
    console.log("cam: "+camx);
    checkInternet(function(isConnected) {
        fs.access(file, function (error) {
            if (!error) {
                fs.stat(file, function(err, stats) {
                    if (parseInt(stats.birthtimeMs / 1000) + parseInt(options.timeLimit) + 60 < time()) {          
                        if (isConnected) {
                            let form = new FormData();
                            form.append("video", fs.createReadStream(file));
                            form.append("organization", options.organization);
                            form.append("cam", camx);
                            form.append("server", options.mac);
                            form.append("department", options.department);
                            form.append("cloud", options.remoteServer);
                            form.submit(options.url, function (err, res) {
                                console.log(form);
                                console.log("otvet: "+res);
                                console.log("err: "+error);
                                if (!err) {
                                    fs.access(file, function (error) {
                                        if (!error) {
                                            fs.unlinkSync(file);
                                        } else {
                                            console.error('Файл уже удален');
                                        }
                                    });
                                    console.log('Видео ' + file + ' загружено!');
                                } else {
                                    console.error('Видео ' + file + ' не загружено!');
                                }
                            });
                        } else {
                            data = {type: "no_internet"};
                            data = JSON.stringify(data);
                            client.write(data);
                        } 
                    } else {
                        console.log("Свежий файл - "+file);
                    }
                });
            } else {
                console.error('Файл уже удален');
            }
        });
    });
}

setTimeout(function(){
    
upload_videos();

start_rec();
}, 2000);